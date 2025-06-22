module.exports = function(io) {
  const express = require('express');
  const router = express.Router();
  const supabase = require('./supabaseClient');
  const axios = require('axios');
  const cheerio = require('cheerio');
  require('dotenv').config();

  // Test route
  router.get('/', (req, res) => {
    res.send('Disaster Response API is running');
  });

  // GET all disasters
  router.get('/disasters', async (req, res) => {
    const { data, error } = await supabase.from('disasters').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // POST a new disaster
  router.post('/disasters', async (req, res) => {
    const { title, location_name, description, tags, owner_id } = req.body;
    const { data, error } = await supabase.from('disasters').insert([{
      title,
      location_name,
      description,
      tags,
      owner_id,
      audit_trail: [{ action: 'create', user_id: owner_id, timestamp: new Date().toISOString() }],
    }]);

    if (error) return res.status(500).json({ error: error.message });
    io.emit('disaster_updated', { type: 'created', disaster: data[0] });
    res.status(201).json(data[0]);
  });

  // UPDATE disaster
  router.put('/disasters/:id', async (req, res) => {
    const { id } = req.params;
    const { title, location_name, description, tags, owner_id } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('disasters').select('audit_trail').eq('id', id).single();
    if (fetchError) return res.status(404).json({ error: 'Not found' });

    const updatedAudit = existing.audit_trail || [];
    updatedAudit.push({ action: 'update', user_id: owner_id || 'unknown', timestamp: new Date().toISOString() });

    const { data, error } = await supabase.from('disasters').update({
      title, location_name, description, tags, audit_trail: updatedAudit,
    }).eq('id', id).select();

    if (error) return res.status(500).json({ error: error.message });
    io.emit('disaster_updated', { type: 'updated', disaster: data[0] });
    res.json(data[0]);
  });

  // DELETE disaster
  router.delete('/disasters/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('disasters').delete().eq('id', id).select();
    if (error) return res.status(500).json({ error: error.message });
    io.emit('disaster_updated', { type: 'deleted', id });
    res.json({ message: 'Deleted', data });
  });

  // POST /geocode: Extract and convert to lat/lng
  router.post('/geocode', async (req, res) => {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description is required' });

    try {
      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: `Extract location from: ${description}` }] }] }
      );

      const location_name = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!location_name) throw new Error('Gemini failed');

      const mapRes = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location_name)}`);
      const best = mapRes.data?.[0];
      if (!best) throw new Error('No location found');

      res.json({ location_name, lat: parseFloat(best.lat), lng: parseFloat(best.lon) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /social-media (mock + cache)
  router.get('/disasters/:id/social-media', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `social-media-${id}`;
    const now = new Date();

    try {
      const { data: cached } = await supabase.from('cache').select('*').eq('key', cacheKey).single();
      if (cached && new Date(cached.expires_at) > now) {
        return res.json({ source: 'cache', posts: cached.value });
      }

      const mockPosts = [
        { post: "#floodrelief Need urgent medical aid in Andheri", user: "citizen1" },
        { post: "#flood Water rising near Andheri West bridge", user: "citizen2" }
      ];
      const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      await supabase.from('cache').upsert({ key: cacheKey, value: mockPosts, expires_at: expiresAt });

      io.emit('social_media_updated', { disaster_id: id, posts: mockPosts });
      res.json({ source: 'fresh', posts: mockPosts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /resources nearby (Supabase RPC)
  router.get('/disasters/:id/resources', async (req, res) => {
    const { id } = req.params;
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

    const radiusInMeters = 10000;
    try {
      const { data, error } = await supabase.rpc('nearby_resources', {
        disaster_id_input: id,
        lat_input: parseFloat(lat),
        lon_input: parseFloat(lon),
        radius_input: radiusInMeters
      });

      if (error) return res.status(500).json({ error: error.message });
      io.emit('resources_updated', { disaster_id: id, lat, lon });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /official-updates (FEMA scrape + cache)
  router.get('/disasters/:id/official-updates', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `official-updates-${id}`;

    try {
      const { data: cached } = await supabase.from('cache').select('*').eq('key', cacheKey).single();
      if (cached && new Date(cached.expires_at) > new Date()) {
        return res.json({ source: 'cache', updates: cached.value });
      }

      const { data: html } = await axios.get('https://www.fema.gov/press-releases');
      const $ = cheerio.load(html);
      const updates = [];

      $('a').each((_, el) => {
        const title = $(el).text().trim();
        const url = $(el).attr('href');
        if (title.length > 20 && url) updates.push({ title, url });
      });

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await supabase.from('cache').upsert({ key: cacheKey, value: updates, expires_at: expiresAt });

      res.json({ source: 'fresh', updates });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /verify-image using Gemini
  router.post('/disasters/:id/verify-image', async (req, res) => {
    const { id } = req.params;
    const { image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url is required' });

    const cacheKey = `image-verification-${id}-${image_url}`;
    try {
      const { data: cached } = await supabase.from('cache').select('*').eq('key', cacheKey).single();
      if (cached && new Date(cached.expires_at) > new Date()) {
        return res.json({ source: 'cache', result: cached.value });
      }

      const prompt = `Analyze image at ${image_url} for signs of manipulation or natural disaster context.`;
      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] }
      );

      const result = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No result';
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      await supabase.from('cache').upsert({ key: cacheKey, value: result, expires_at: expiresAt });

      res.json({ source: 'fresh', result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
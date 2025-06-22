# Disaster Response Coordination Platform – Backend

This is the backend API for the Disaster Response Coordination Platform, built using Node.js, Express.js, Supabase, and Socket.IO. It supports real-time disaster reporting, location extraction, image verification, social media aggregation, and geospatial resource mapping.

## 🧰 Tech Stack

- Node.js
- Express.js
- Supabase (PostgreSQL + PostGIS)
- Google Gemini API
- OpenStreetMap / Nominatim
- Socket.IO (WebSockets)
- Axios
- Cheerio (Web scraping)

## 📦 Features

- Disaster CRUD operations with audit trail
- Location extraction using Gemini + geocoding via OSM
- Image verification using Gemini
- Social media monitoring (mock data + Supabase caching)
- Geospatial queries for nearby resources
- Official updates scraping from FEMA
- WebSocket-based real-time updates

## 📁 Directory Structure

```
src/
├── index.js             # Express + Socket.IO entry point
├── routes.js            # All REST API routes
├── supabaseClient.js    # Supabase initialization
.env                     # Environment variables (not committed)
```

## 🔐 Environment Variables

Create a `.env` file in the root directory with the following:

```env
PORT=5001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
```

## 🧪 Key API Endpoints

- `GET /api/disasters`
- `POST /api/disasters`
- `PUT /api/disasters/:id`
- `DELETE /api/disasters/:id`
- `POST /api/geocode`
- `GET /api/disasters/:id/social-media`
- `GET /api/disasters/:id/resources?lat=...&lon=...`
- `GET /api/disasters/:id/official-updates`
- `POST /api/disasters/:id/verify-image`

## 💡 Notes

- Uses Supabase caching to reduce external API load
- Geospatial queries use `ST_DWithin` via Supabase RPC
- Socket.IO broadcasts events on disaster/resource updates

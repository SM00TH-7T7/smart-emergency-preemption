# SmartCorridor Deployment Guide

## Prerequisites
- Vercel account (https://vercel.com)
- GitHub repository with your code
- Environment variables configured

## Environment Variables

Set these in your Vercel Project Settings (Environment Variables):

### Required
- `VITE_MAPBOX_TOKEN`: Your Mapbox public token
- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `VITE_API_URL`: For production, use `https://your-domain.vercel.app/api`

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "Add Vercel deployment config"
git push
```

### 2. Deploy to Vercel
1. Go to https://vercel.com
2. Click "New Project"
3. Import your GitHub repository
4. Configure project:
   - **Framework**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add Environment Variables (see section above)
6. Deploy

### 3. Configure Environment Variables in Vercel Dashboard
After initial deployment, go to Project Settings → Environment Variables and add:
- `VITE_MAPBOX_TOKEN`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` = `https://your-domain.vercel.app/api`

## Signal Operations Display
- ✅ Signal state (GREEN/RED) display added
- ✅ Queue count visualization per signal
- ✅ Real-time status updates during dispatch

## Hospital Rerouting Display
- ✅ Selected hospital information display
- ✅ Distance and ETA calculation
- ✅ Hospital routing target shown during mission

## Local Development

### Frontend Only
```bash
npm install
npm run dev
```

### With Local API (Python)
```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
python -m uvicorn api:app --reload
```

### Environment for Local Dev
Create `.env.local`:
```
VITE_MAPBOX_TOKEN=your_token_here
VITE_SUPABASE_URL=your_url_here
VITE_SUPABASE_ANON_KEY=your_key_here
VITE_API_URL=http://127.0.0.1:8000
```

## Troubleshooting

### Build Fails on Vercel
- Ensure all dependencies are listed in `package.json`
- Check that `npm run build` works locally first

### API Calls Fail in Production
- Verify `VITE_API_URL` is set to `https://your-domain.vercel.app/api`
- Check CORS is enabled in FastAPI (already configured)
- Verify the model file `smart_brain.pth` is in the root directory

### Signal Operations Not Showing
- Ensure traffic lights array is being populated
- Check mission status is 'running' or 'completed'
- Verify no console errors in browser DevTools

## Performance Notes
- Model loading happens once at startup
- API responses are optimized for sub-100ms latency
- Signal updates sync with animation frame (60fps)

## Next Steps
1. Deploy to Vercel
2. Test signal operations display with a dispatch mission
3. Verify hospital routing information appears
4. Monitor Vercel logs for any API errors

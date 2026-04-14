# Smart Emergency Vehicle Preemption System

## Project Overview
The **Smart Emergency Vehicle Preemption System (SEVPS)** is a decentralized, AI-driven traffic simulation built to modernize how rapid-response vehicles traverse congested urban environments. Designed initially as an experimental framework for a Master's Thesis, this local simulator successfully implements "Green Tunnel" logic, bypassing manual standard timer signals through high-speed predictive intersection clearance.

## Tech Stack
* **Frontend:** React, Vite, Tailwind CSS, Lucide Icons
* **Geospatial & Visualization:** Mapbox GL JS, Maps API, Turf.js
* **Backend:** Python FastAPI (REST Protocol)
* **Prediction Model:** PyTorch (Deep Q-Network Agent)

## Key Features
1. **Dynamic A/B Simulation Engine:**
   Run dual-simulated pathways evaluating Standard fixed-cycle timers versus AI Preemption. The engine tracks precise intersection delay penalties dynamically.

2. **Geospatial Telemetry via OpenStreetMap (Overpass API):**
   Utilizes live geographical boundaries mapping active Hospital geometries, routing algorithms, and localized traffic flow data perfectly locked against actual real-world topographies. 

3. **High Fidelity Render Nodes:** 
   Fully integrated mathematical queue visualization showcasing traffic capacity at varying alert layers (Green, Amber, Red). Visually clears nodes in precise parallel alongside the AI API intercept calls.

4. **Safety Driven:**
   Strict coordinate-error catches evaluating OSM topological data (ensuring markers remain exclusively locked to driveable road polygons). Secure tokenized builds.

## Setup Instructions

### 1. Requirements
* Node.js (v18+)
* Python 3.10+
* Mapbox GL API Token

### 2. Installation (Frontend)
Clone the repository, verify your node environment, and install dependencies:
```bash
npm install
```

### 3. Environment Variables
To ensure map topography and direction APIs bind correctly, you must supply your Mapbox token.
Create a local `.env` file at the root of the project and populate it:
```bash
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

### 4. Running Locally
Start your FastAPI backend server containing the PyTorch DQN model evaluation:
```bash
python api.py
```

Then boot the React simulator frontend:
```bash
npm run dev
```

The interface will immediately deploy dark-mode glassmorphic panes on `http://localhost:5173`. Select an emergency coordinate to begin the routing dispatch loop.

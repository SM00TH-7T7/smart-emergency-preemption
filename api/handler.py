import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mangum import Mangum

class DQN(nn.Module):
    def __init__(self, state_dim, action_dim):
        super(DQN, self).__init__()
        self.fc1 = nn.Linear(state_dim, 64)
        self.fc2 = nn.Linear(64, 64)
        self.fc3 = nn.Linear(64, action_dim)
        
    def forward(self, x):
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        return self.fc3(x)

# Load model
print("Loading Smart AI Brain...")
model = DQN(state_dim=2, action_dim=4)
try:
    model.load_state_dict(torch.load("smart_brain.pth", map_location=torch.device('cpu')))
except:
    print("Warning: smart_brain.pth not found. Using untrained model.")
model.eval()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TrafficState(BaseModel):
    ev_distance: float
    sv_queue: int

@app.post("/predict")
async def get_action(state: TrafficState):
    norm_distance = state.ev_distance / 1000.0
    norm_queue = state.sv_queue / 50.0
    
    state_array = np.array([norm_distance, norm_queue])
    state_tensor = torch.FloatTensor(state_array).unsqueeze(0)
    
    with torch.no_grad():
        action = model(state_tensor).max(1)[1].item()
        
    action_names = {
        0: "Maintain Current Phase (Red)",
        1: "Predictive Clearing (Slow Green)",
        2: "Pre-Emptive Discharge (Fast Green)",
        3: "Green Tunnel (Emergency Override)"
    }
    
    return {
        "action_code": action,
        "action_name": action_names[action]
    }

@app.get("/health")
async def health():
    return {"status": "ok"}

handler = Mangum(app)

import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
import random
import numpy as np

# 1. The Brain Architecture
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

class ReplayBuffer:
    def __init__(self, capacity):
        self.buffer = []
        self.capacity = capacity
        self.position = 0
    def push(self, *args):
        if len(self.buffer) < self.capacity: self.buffer.append(None)
        self.buffer[self.position] = args
        self.position = (self.position + 1) % self.capacity
    def sample(self, batch_size):
        return zip(*random.sample(self.buffer, batch_size))
    def __len__(self): return len(self.buffer)

# 2. The Strict Logic Environment
class SmartTrafficEnv:
    def reset(self):
        self.dist = random.uniform(50, 1000)
        self.queue = random.randint(0, 50)
        return np.array([self.dist / 1000.0, self.queue / 50.0]) # <-- NORMALIZED!
        
    def step(self, action):
        reward = 0
        # Strict rules for the AI to learn
        if self.dist > 600:
            if action == 0: reward = 10 # Good: Maintain normal traffic
            else: reward = -20 # Bad: Don't panic early
        elif self.dist > 250:
            if self.queue > 15 and action in [1, 2]: reward = 10 # Good: Start clearing
            elif action == 0: reward = -10
        else: # Critical Zone (< 250m)
            if self.queue > 10 and action == 3: reward = 50 # Good: Green Tunnel!
            elif action < 2: reward = -50 # Bad: Ambulance is blocked!
            
        self.dist -= random.uniform(50, 150)
        self.queue += random.randint(-2, 5)
        self.queue = max(0, min(50, self.queue))
        
        done = self.dist <= 0
        return np.array([self.dist / 1000.0, self.queue / 50.0]), reward, done

# 3. Super-Fast Training Loop
if __name__ == "__main__":
    env = SmartTrafficEnv()
    policy_net = DQN(2, 4)
    optimizer = optim.Adam(policy_net.parameters(), lr=0.001)
    memory = ReplayBuffer(5000)
    
    print("Training normalized DQN...")
    for episode in range(1500):
        state = env.reset()
        done = False
        while not done:
            # Explore vs Exploit
            if random.random() > 0.1:
                with torch.no_grad(): action = policy_net(torch.FloatTensor(state).unsqueeze(0)).max(1)[1].item()
            else: action = random.randint(0, 3)
                
            next_state, reward, done = env.step(action)
            memory.push(state, action, reward, next_state, done)
            state = next_state
            
            # Learn
            if len(memory) > 64:
                s, a, r, ns, d = memory.sample(64)
                s_batch = torch.FloatTensor(np.array(s))
                a_batch = torch.LongTensor(a).unsqueeze(1)
                r_batch = torch.FloatTensor(r)
                
                q_vals = policy_net(s_batch).gather(1, a_batch)
                with torch.no_grad(): max_next_q = policy_net(torch.FloatTensor(np.array(ns))).max(1)[0]
                expected_q = r_batch + (0.99 * max_next_q * (1 - torch.FloatTensor(d)))
                
                loss = F.mse_loss(q_vals, expected_q.unsqueeze(1))
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                
        if episode % 300 == 0: print(f"Episode {episode} complete...")

    torch.save(policy_net.state_dict(), "smart_brain.pth")
    print("Success! Saved as 'smart_brain.pth'")
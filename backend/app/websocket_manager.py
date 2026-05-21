"""
WebSocket Manager for Real-Time Hospital Updates
Manages connections and broadcasts updates to all connected clients
"""
from typing import Set, Dict, List
import json

class ConnectionManager:
    def __init__(self):
        """Initialize connection manager with connection tracking"""
        self.active_connections: Set = set()
        self.user_connections: Dict[str, Set] = {}  # Track by user_id for targeted broadcasts
        
    async def connect(self, websocket, user_id: str = None):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        self.active_connections.add(websocket)
        
        if user_id:
            if user_id not in self.user_connections:
                self.user_connections[user_id] = set()
            self.user_connections[user_id].add(websocket)
        print(f"✅ WebSocket connected. Total active: {len(self.active_connections)}")
        
    async def disconnect(self, websocket, user_id: str = None):
        """Remove a disconnected WebSocket"""
        self.active_connections.discard(websocket)
        
        if user_id and user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]
        print(f"❌ WebSocket disconnected. Total active: {len(self.active_connections)}")
        
    async def broadcast(self, message: dict):
        """Broadcast message to ALL connected clients"""
        if not self.active_connections:
            return
            
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"⚠️  Broadcast error: {e}")
                disconnected.add(connection)
        
        # Clean up dead connections
        for conn in disconnected:
            self.active_connections.discard(conn)
    
    async def broadcast_to_user(self, user_id: str, message: dict):
        """Send message to specific user's connections only"""
        if user_id not in self.user_connections:
            return
            
        disconnected = set()
        for connection in self.user_connections[user_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"⚠️  User broadcast error: {e}")
                disconnected.add(connection)
        
        # Clean up dead connections
        for conn in disconnected:
            self.user_connections[user_id].discard(conn)
            self.active_connections.discard(conn)
    
    async def broadcast_to_doctors(self, message: dict):
        """Send message only to doctor role users"""
        # This would require tracking roles, for now broadcast to all
        await self.broadcast(message)
    
    async def broadcast_to_role(self, role: str, message: dict):
        """Send message to users with specific role"""
        # Extended version: you'd need to track role per user_id
        await self.broadcast(message)

# Global manager instance
manager = ConnectionManager()

from fastapi import FastAPI, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional
import os

from backend.database import engine, Base, get_db
from backend.services.thread_service import ThreadService
from backend.services.memory_service import MemoryService
from backend.services.llm_service import LLMService

# Create SQLite Database tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Universal Memory Chat API", version="1.0.0")

# Enable CORS for Streamlit Frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared Global Settings (In-memory configuration for demonstration)
SOFT_DELETE_MEMORY = True

# Service Instantiations
llm_service = LLMService()

# Pydantic Schemas
class MessageCreate(BaseModel):
    content: str

class ThreadCreate(BaseModel):
    title: Optional[str] = None

class ThreadRename(BaseModel):
    title: str

class ChatPayload(BaseModel):
    thread_id: str
    message: str

class SettingsUpdate(BaseModel):
    soft_delete: bool

# Background task for Smart Memory Extraction
def run_memory_extraction(user_message: str, assistant_reply: str, thread_id: str, db_session_factory):
    # Retrieve a separate db connection for thread safety inside background task
    db = db_session_factory()
    try:
        facts = llm_service.extract_memories(user_message, assistant_reply)
        for fact in facts:
            text = fact.get("memory_text")
            score = fact.get("importance_score", 5)
            if text:
                MemoryService.add_memory(
                    db=db,
                    memory_text=text,
                    source_thread_id=thread_id,
                    importance_score=score
                )
    except Exception as e:
        print(f"Background Extraction Task Error: {e}")
    finally:
        db.close()

# API Server Endpoints
@app.post("/thread/create")
def create_chat_thread(payload: ThreadCreate, db: Session = Depends(get_db)):
    thread = ThreadService.create_thread(db, payload.title)
    return {"success": True, "thread": {
        "id": thread.id,
        "title": thread.title,
        "created_at": thread.created_at.isoformat()
    }}

@app.get("/threads")
def get_all_threads(db: Session = Depends(get_db)):
    threads = ThreadService.get_all_threads(db)
    return {"success": True, "threads": [
        {"id": t.id, "title": t.title, "created_at": t.created_at.isoformat()} for t in threads
    ]}

@app.get("/thread/{id}")
def get_thread_by_id(id: str, db: Session = Depends(get_db)):
    thread = ThreadService.get_thread_by_id(db, id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    messages = ThreadService.get_thread_messages(db, id)
    memories = db.query(MemoryEntry).filter(MemoryEntry.source_thread_id == id).all() if hasattr(db, 'query') else []
    
    return {
        "success": True, 
        "thread": {"id": thread.id, "title": thread.title, "created_at": thread.created_at.isoformat()},
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in messages
        ],
        "memories": [
            {"id": mem.id, "memory_text": mem.memory_text, "importance_score": mem.importance_score} for mem in memories
        ]
    }

@app.put("/thread/{id}/rename")
def rename_thread(id: str, payload: ThreadRename, db: Session = Depends(get_db)):
    thread = ThreadService.rename_thread(db, id, payload.title)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"success": True, "thread": {"id": thread.id, "title": thread.title}}

@app.delete("/thread/{id}")
def delete_thread(id: str, db: Session = Depends(get_db)):
    global SOFT_DELETE_MEMORY
    result = ThreadService.delete_thread(db, id, soft_delete_memory=SOFT_DELETE_MEMORY)
    if not result:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"success": True, "detail": "Thread and messages deleted successfuly"}

@app.get("/search")
def search_history(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    results = ThreadService.search_messages_and_threads(db, q)
    return {"success": True, "results": results}

@app.get("/memory")
def get_memories(db: Session = Depends(get_db)):
    memories = MemoryService.get_all_memories(db)
    return {"success": True, "memories": [
        {
            "id": m.id,
            "memory_text": m.memory_text,
            "source_thread_id": m.source_thread_id,
            "source_thread_title": m.thread.title if m.thread else "Extracted Context",
            "importance_score": m.importance_score,
            "created_at": m.created_at.isoformat()
        } for m in memories
    ]}

@app.delete("/memory/{id}")
def delete_memory(id: str, db: Session = Depends(get_db)):
    deleted = MemoryService.delete_memory_entry(db, id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return {"success": True, "detail": "Memory deleted successfully"}

@app.get("/settings")
def get_settings():
    global SOFT_DELETE_MEMORY
    return {"success": True, "soft_delete": SOFT_DELETE_MEMORY}

@app.put("/settings")
def update_settings(payload: SettingsUpdate):
    global SOFT_DELETE_MEMORY
    SOFT_DELETE_MEMORY = payload.soft_delete
    return {"success": True, "soft_delete": SOFT_DELETE_MEMORY}

@app.post("/chat")
def handle_chat_message(payload: ChatPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # 1. Save user input
    ThreadService.add_message(db, payload.thread_id, "user", payload.message)

    # 2. Memory Retrieval System
    relevant_memories = MemoryService.get_relevant_memories(db, payload.message)

    # 3. Retrieve recent context for prompt construction
    history = ThreadService.get_thread_messages(db, payload.thread_id)
    chat_logs = [{"role": msg.role, "content": msg.content} for msg in history]

    # 4. Prompt Assembly
    memory_section = "\n".join([
        f"- {m.memory_text} (Importance Score: {m.importance_score}/10, Source Thread: {m.thread.title if m.thread else 'Other Thread'})"
        for m in relevant_memories
    ])

    system_instruction = (
        "You are an AI assistant with access to the user's permanent cross-thread long-term memory backend.\n"
        "Integrate the retrieved knowledge seamlessly without overly saying 'according to my database memory entries'.\n\n"
        "RELEVANT MEMORIES DETECTED:\n"
        f"{memory_section or 'No prior relevant context found.'}\n\n"
        "Deliver professional, accurate, and contextually rich replies that make full use of these memories."
    )

    # 5. Generate completion
    assistant_reply = llm_service.generate_chat_response(system_instruction, chat_logs)

    # 6. Save Assistant response
    ThreadService.add_message(db, payload.thread_id, "assistant", assistant_reply)

    # 7. Background Memory Extraction Task
    # We pass the db session maker factory to ensure thread isolation in background worker
    from backend.database import SessionLocal
    background_tasks.add_task(
        run_memory_extraction,
        payload.message,
        assistant_reply,
        payload.thread_id,
        SessionLocal
    )

    return {
        "success": True,
        "reply": assistant_reply,
        "injected_memories": [
            {"id": m.id, "memory_text": m.memory_text, "importance_score": m.importance_score} for m in relevant_memories
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

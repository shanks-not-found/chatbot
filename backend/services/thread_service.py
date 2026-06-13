from sqlalchemy.orm import Session
import uuid
from typing import List, Optional
from backend.models import ChatThread, Message, MemoryEntry

class ThreadService:
    @staticmethod
    def get_all_threads(db: Session) -> List[ChatThread]:
        return db.query(ChatThread).order_on(ChatThread.created_at.desc()).all() if hasattr(db.query(ChatThread), 'order_on') else db.query(ChatThread).order_by(ChatThread.created_at.desc()).all()

    @staticmethod
    def get_thread_by_id(db: Session, thread_id: str) -> Optional[ChatThread]:
        return db.query(ChatThread).filter(ChatThread.id == thread_id).first()

    @staticmethod
    def create_thread(db: Session, title: Optional[str] = None) -> ChatThread:
        thread_id = "thread-" + str(uuid.uuid4())[:8]
        if not title:
            thread_count = db.query(ChatThread).count()
            title = f"Chat Thread {thread_count + 1}"
            
        thread = ChatThread(id=thread_id, title=title)
        db.add(thread)
        db.commit()
        db.refresh(thread)
        return thread

    @staticmethod
    def rename_thread(db: Session, thread_id: str, new_title: str) -> Optional[ChatThread]:
        thread = db.query(ChatThread).filter(ChatThread.id == thread_id).first()
        if thread:
            thread.title = new_title
            db.commit()
            db.refresh(thread)
        return thread

    @staticmethod
    def delete_thread(db: Session, thread_id: str, soft_delete_memory: bool = True) -> bool:
        """
        Delete thread and its messages.
        Based on configuration flag `soft_delete_memory`:
        - If True (Soft Delete): Keep memory entries that originated from this thread.
        - If False (Hard Delete): Remove memory entries that were extracted from this thread.
        """
        thread = db.query(ChatThread).filter(ChatThread.id == thread_id).first()
        if not thread:
            return False

        # If hard delete memory, delete associated memories first
        if not soft_delete_memory:
            db.query(MemoryEntry).filter(MemoryEntry.source_thread_id == thread_id).delete()
        else:
            # Nullify source relationship to prevent foreign key errors if CASCADE is not set
            memories = db.query(MemoryEntry).filter(MemoryEntry.source_thread_id == thread_id).all()
            for mem in memories:
                mem.source_thread_id = None

        # Delete database thread (messages will cascades delete through relationships setup)
        db.delete(thread)
        db.commit()
        return True

    @staticmethod
    def add_message(db: Session, thread_id: str, role: str, content: str) -> Message:
        msg_id = "msg-" + str(uuid.uuid4())[:8]
        message = Message(
            id=msg_id,
            thread_id=thread_id,
            role=role,
            content=content
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    @staticmethod
    def get_thread_messages(db: Session, thread_id: str) -> List[Message]:
        return db.query(Message).filter(Message.thread_id == thread_id).order_by(Message.created_at.asc()).all()

    @staticmethod
    def search_messages_and_threads(db: Session, query: str) -> List[dict]:
        """
        Search through all thread titles and messages matching query.
        """
        search_query = f"%{query}%"
        # Search messages
        messages = db.query(Message).filter(Message.content.like(search_query)).all()
        results = []
        for msg in messages:
            results.append({
                "thread_id": msg.thread_id,
                "thread_title": msg.thread.title,
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat()
            })
        return results

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChatThread(Base):
    __tablename__ = "chat_threads"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    messages = relationship("Message", back_populates="thread", cascade="all, delete-orphan")
    memories = relationship("MemoryEntry", back_populates="thread")

class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    thread_id = Column(String, ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    thread = relationship("ChatThread", back_populates="messages")

class MemoryEntry(Base):
    __tablename__ = "memory_entries"

    id = Column(String, primary_key=True, index=True)
    memory_text = Column(Text, nullable=False)
    source_thread_id = Column(String, ForeignKey("chat_threads.id", ondelete="SET NULL"), nullable=True)
    importance_score = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    thread = relationship("ChatThread", back_populates="memories")

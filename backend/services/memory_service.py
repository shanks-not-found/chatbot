from sqlalchemy.orm import Session
from sqlalchemy import or_
import uuid
from typing import List
from backend.models import MemoryEntry, ChatThread

class MemoryService:
    @staticmethod
    def get_all_memories(db: Session) -> List[MemoryEntry]:
        """
        Get all long-term memory entries sorted by importance scorer.
        """
        return db.query(MemoryEntry).order_on(MemoryEntry.importance_score.desc()).all() if hasattr(db.query(MemoryEntry), 'order_on') else db.query(MemoryEntry).order_by(MemoryEntry.importance_score.desc()).all()

    @staticmethod
    def get_relevant_memories(db: Session, user_message: str, limit: int = 5) -> List[MemoryEntry]:
        """
        Match words in user query against long term memories to find context.
        Boost score by importance weight.
        """
        all_memories = db.query(MemoryEntry).all()
        if not all_memories:
            return []

        stopwords = {
            "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", 
            "he", "him", "his", "she", "her", "it", "its", "they", "them", "who", "what", "which", 
            "where", "when", "why", "how", "is", "am", "are", "was", "were", "be", "been", "being", 
            "have", "has", "had", "do", "does", "did", "a", "an", "the", "and", "but", "if", "or", 
            "because", "as", "until", "while", "of", "at", "by", "for", "with", "about", "against", 
            "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", 
            "up", "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", 
            "here", "there", "all", "any", "both", "each", "few", "more", "most", "other", "some", 
            "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "can", 
            "will", "just", "should", "now", "have", "mention", "mentioned"
        }

        # Tokenize query
        clean_msg = "".join([c.lower() if c.isalnum() or c.isspace() else "" for c in user_message])
        words = [w for w in clean_msg.split() if len(w) > 2 and w not in stopwords]

        if not words:
            # Fallback to general high importance memories
            return sorted(all_memories, key=lambda x: x.importance_score, reverse=True)[:limit]

        scored_memories = []
        for mem in all_memories:
            mem_text_clean = "".join([c.lower() if c.isalnum() or c.isspace() else "" for c in mem.memory_text])
            mem_words = mem_text_clean.split()
            
            match_count = 0
            for qw in words:
                if any(qw in mw or mw in qw for mw in mem_words):
                    match_count += 1
            
            # Weighted score: match count multiplied by importance
            score = match_count * (mem.importance_score + 1)
            scored_memories.append((mem, score))

        # Sort by match score first, then fallback to original importance score
        scored_memories.sort(key=lambda x: (x[1], x[0].importance_score), reverse=True)
        
        # Filter high matches
        hits = [item[0] for item in scored_memories if item[1] > 0]
        if hits:
            return hits[:limit]
            
        # Return standard highest importance memories if no query matches
        return sorted(all_memories, key=lambda x: x.importance_score, reverse=True)[:limit]

    @staticmethod
    def add_memory(db: Session, memory_text: str, source_thread_id: str, importance_score: int) -> MemoryEntry:
        """
        Add a long term memory, applying basic deduplication.
        """
        existing = db.query(MemoryEntry).filter(MemoryEntry.memory_text == memory_text).first()
        if existing:
            # Update score if importance increases
            if importance_score > existing.importance_score:
                existing.importance_score = importance_score
            db.commit()
            return existing

        new_id = "mem-" + str(uuid.uuid4())[:8]
        memory = MemoryEntry(
            id=new_id,
            memory_text=memory_text,
            source_thread_id=source_thread_id,
            importance_score=importance_score
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return memory

    @staticmethod
    def delete_memory_entry(db: Session, memory_id: str) -> bool:
        """
        Manually remove an extracted fact.
        """
        memory = db.query(MemoryEntry).filter(MemoryEntry.id == memory_id).first()
        if memory:
            db.delete(memory)
            db.commit()
            return True
        return False

# 🧠 Universal Memory Chat

A production-ready full-stack application featuring **Universal Cross-Thread Memory** with automated fact extraction and active recall context seeding.

This repository features **two state-of-the-art implementations**:
1. **Interactive Full-Stack Web App (React + Express Server)**: Active and fully functional model playground configured for direct Google AI Studio previews (running on port 3000).
2. **Modular Python Codebase (FastAPI + SQLAlchemy SQLite + Streamlit)**: Ready-to-go Python layout fully compliant with clean architecture guidelines.

---

## 🎨 Core Architectural Features

* **Multiple Chat Threads**: Create, rename, delete, and instantly switch between isolated chat threads.
* **Universal Memory Engine**: A permanent, global database of facts extracted from all conversations. Information mentioned in one thread becomes instantly available in any other thread.
* **Smart Memory Extraction Service**: Automatically extracts healthcare metrics, allergies, occupations, goals, interests, projects, and personal particulars using Gemini.
* **Memory Relevance Seeding**: Before dispatching chat logs to the LLM, the backend queries the database for relevant memories based on keyword token matches and importance, dynamically injecting them into the system prompt.
* **Variable Configurations**: Easily switch between **Soft Delete** (keeping memory logs even if their source thread is deleted) or **Hard Delete** (scrubbing both history and extraction logs).

---

## 📦 Python (FastAPI + Streamlit + SQLAlchemy) Quickstart

### 1. Prerequisites
Ensure you have Python 3.10+ installed.

### 2. Installation
Install the necessary package frameworks:
```bash
pip install -r requirements.txt
```

### 3. Setup Environment Variables
Configure your keys in `.env` (copy from `.env.example`):
```env
# Choose provider: gemini, openai, or groq
LLM_PROVIDER="gemini"
GEMINI_API_KEY="your-google-gemini-key"

# Database
DATABASE_URL="sqlite:///./universal_memory.db"
BACKEND_URL="http://localhost:8000"
```

### 4. Run Backend Server (FastAPI)
Launch the API backend:
```bash
# From project root
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```
This automatically boots SQLAlchemy, initializes the database schema, and generates `universal_memory.db` inside your SQLite instance.

### 5. Run Frontend Client (Streamlit)
Launch the interactive Streamlit dashboard:
```bash
streamlit run frontend/app.py
```

---

## 💻 Tech Stack Specification

* **Frontend**: Streamlit / React (Lucide Icons, Tailwind CSS, Motion animations)
* **Backend**: FastAPI / Express
* **Database**: SQLite / SQL via SQLAlchemy ORM (custom structured database)
* **LLM**: Gemini-3.5-flash (Standard model of choice), OpenAI, or Groq

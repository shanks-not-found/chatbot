import streamlit as st
import requests
import os
from datetime import datetime

# Initialize environment & endpoints
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

# Set Page Config
st.set_page_config(
    page_title="Universal Memory Chat",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom css for beautiful chat layout
st.markdown("""
<style>
    .memory-tag {
        background-color: #EBF5FB;
        border-radius: 12px;
        padding: 4px 10px;
        font-size: 0.85em;
        color: #2471A3;
        border: 1px solid #AED6F1;
        margin-right: 5px;
        margin-bottom: 5px;
        display: inline-block;
    }
    .memory-header {
         color: #1F618D;
         font-weight: bold;
         margin-bottom: 8px;
    }
    .score-badge {
         background-color: #F8C471;
         color: #7E5109;
         border-radius: 6px;
         padding: 1px 6px;
         font-size: 0.8em;
         font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# Helper Request wrappers
def api_get(endpoint, params=None):
    try:
        res = requests.get(f"{BACKEND_URL}{endpoint}", params=params)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"Failed to contact FastAPI backend at {BACKEND_URL}. Is it running?")
    return None

def api_post(endpoint, json_data):
    try:
        res = requests.post(f"{BACKEND_URL}{endpoint}", json=json_data)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"Failed to post to backend: {e}")
    return None

def api_put(endpoint, json_data=None):
    try:
        res = requests.put(f"{BACKEND_URL}{endpoint}", json=json_data)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"Failed to put to backend: {e}")
    return None

def api_delete(endpoint):
    try:
        res = requests.delete(f"{BACKEND_URL}{endpoint}")
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        st.error(f"Failed to delete resource: {e}")
    return None

# Load initial configuration states
if "current_thread_id" not in st.session_state:
    st.session_state.current_thread_id = None
if "last_injected_memories" not in st.session_state:
    st.session_state.last_injected_memories = []

# Sidebar header
st.sidebar.title("🧠 Universal Memory")
st.sidebar.subheader("Cross-Thread Log")

# New Chat Button
if st.sidebar.button("➕ New Chat Thread", use_container_width=True):
    new_thread_res = api_post("/thread/create", {})
    if new_thread_res and new_thread_res.get("success"):
        st.session_state.current_thread_id = new_thread_res["thread"]["id"]
        st.success("New thread created!")
        st.rerun()

# Settings: Soft/Hard Delete Toggle
settings_res = api_get("/settings")
soft_delete_val = True
if settings_res and "soft_delete" in settings_res:
    soft_delete_val = settings_res["soft_delete"]

new_soft_delete = st.sidebar.toggle(
    "Soft Delete Memory on Thread Delete", 
    value=soft_delete_val,
    help="When enabled, thread memories stay in Universal Memory even if the source thread is deleted. If disabled, memories are hard-deleted with the thread."
)
if new_soft_delete != soft_delete_val:
    api_put("/settings", {"soft_delete": new_soft_delete})
    st.sidebar.success(f"Settings updated! Soft delete: {new_soft_delete}")

st.sidebar.divider()

# Thread List Selection Sidebar
st.sidebar.subheader("Chat Threads")
threads_res = api_get("/threads")
threads = []
if threads_res and "threads" in threads_res:
    threads = threads_res["threads"]

selected_idx = 0
thread_titles = []
thread_ids = []

for idx, t in enumerate(threads):
    thread_titles.append(t["title"])
    thread_ids.append(t["id"])
    if t["id"] == st.session_state.current_thread_id:
        selected_idx = idx

# Thread switching picker
if thread_ids:
    picked_title_idx = st.sidebar.selectbox(
        "Open Thread", 
        range(len(thread_titles)), 
        format_func=lambda x: thread_titles[x],
        index=selected_idx
    )
    if thread_ids[picked_title_idx] != st.session_state.current_thread_id:
        st.session_state.current_thread_id = thread_ids[picked_title_idx]
        st.session_state.last_injected_memories = [] # Clear memory tags trace on switch
        st.rerun()
else:
    st.sidebar.info("No active chat threads. Create a new thread above!")

# Thread management panel
if st.session_state.current_thread_id:
    # Find active object
    active_thread = next((t for t in threads if t["id"] == st.session_state.current_thread_id), None)
    if active_thread:
        st.sidebar.divider()
        st.sidebar.subheader("Manage Current Thread")
        
        # Rename thread
        new_title_input = st.sidebar.text_input("Rename Title", value=active_thread["title"])
        if st.sidebar.button("Update Title", use_container_width=True):
            rename_res = api_put(f"/thread/{st.session_state.current_thread_id}/rename", {"title": new_title_input})
            if rename_res and rename_res.get("success"):
                st.sidebar.success("Renamed successfuly!")
                st.rerun()
                
        # Delete thread
        if st.sidebar.button("🗑️ Delete Thread", type="secondary", use_container_width=True):
            del_res = api_delete(f"/thread/{st.session_state.current_thread_id}")
            if del_res and del_res.get("success"):
                st.session_state.current_thread_id = None
                st.session_state.last_injected_memories = []
                st.warning("Thread deleted!")
                st.rerun()

st.sidebar.divider()

# Sidebar Search Component
st.sidebar.subheader("🔍 Search Old Conversations")
search_q = st.sidebar.text_input("Search Messages/Memories", placeholder="e.g. pain")
if search_q:
    search_res = api_get("/search", params={"q": search_q})
    if search_res and search_res.get("success"):
        results = search_res["results"]
        if results:
            st.sidebar.write(f"Found {len(results)} matches:")
            for item in results:
                st.sidebar.markdown(f"**Chat:** `{item['thread_title']}`")
                st.sidebar.markdown(f"*{item['role']}:* {item['content']}")
                st.sidebar.divider()
        else:
            st.sidebar.info("No matched logs discovered.")


# MAIN PANEL LAYOUT
st.title("🧠 Universal Cross-Thread Memory Chat")
st.caption("SQLite backed cognitive memory database displaying dynamic fact extraction and active recall.")

main_col, memory_col = st.columns([2, 1])

with main_col:
    # Active Thread Chat Panel
    if st.session_state.current_thread_id:
        # Load thread content
        thread_details = api_get(f"/thread/{st.session_state.current_thread_id}")
        if thread_details and thread_details.get("success"):
            active_info = thread_details["thread"]
            messages = thread_details["messages"]
            
            st.subheader(f"💬 {active_info['title']}")
            
            # Show actively recalled context trace
            if st.session_state.last_injected_memories:
                with st.expander("🔗 Cognitive Long-Term Recalls Loaded", expanded=True):
                    st.markdown("<div class='memory-header'>Active memories loaded for context:</div>", unsafe_allow_html=True)
                    for item in st.session_state.last_injected_memories:
                        st.markdown(
                            f"<span class='memory-tag'>⚙️ {item['memory_text']} <span class='score-badge'>Score: {item['importance_score']}</span></span>", 
                            unsafe_allow_html=True
                        )

            # Display Messages
            for msg in messages:
                role = "user" if msg["role"] == "user" else "assistant"
                with st.chat_message(role):
                    st.write(msg["content"])
                    st.caption(f"{msg['created_at']}")

            # Input field
            user_input = st.chat_input("Write a message to your health companion...")
            if user_input:
                # Instantly display user bubble
                with st.chat_message("user"):
                    st.write(user_input)

                # Send request
                with st.spinner("Analyzing memory & constructing response..."):
                    payload = {
                        "thread_id": st.session_state.current_thread_id,
                        "message": user_input
                    }
                    reply_res = api_post("/chat", payload)
                    if reply_res and reply_res.get("success"):
                        st.session_state.last_injected_memories = reply_res.get("injected_memories", [])
                        st.rerun()
    else:
        # Prompt user to select or start thread
        st.info("👋 Select an existing conversation from the sidebar or click 'New Chat Thread' to begin!")
        
        # Display instructions
        st.markdown("""
        ### How the Universal Memory System Works
        
        1. **Thread Separation:** Every chat thread runs as an isolated conversation log (with its own active messages).
        2. **Semantic Knowledge Extraction:** After each model query, a background thread scrutinizes the exchange. It detects important user configurations (healthcare flags, locations, jobs, favorites) and stores them globally.
        3. **Universal Recall injection:** Prior to dispatching a new chat message to the LLM, the backend queries the database for **any** relevant context across **all** threads, then seeds it into the active Prompt context automatically!
        """)

with memory_col:
    # Global permanent memories viewer
    st.subheader("💡 Universal Memory Bank")
    st.caption("Fact store shared across ALL chat threads. Automatically generated in background.")
    
    # Reload memories from DB
    memories_res = api_get("/memory")
    if memories_res and memories_res.get("success"):
        mem_list = memories_res["memories"]
        if mem_list:
            for mem in mem_list:
                with st.container(border=True):
                    st.write(f"**{mem['memory_text']}**")
                    col1, col2 = st.columns([3, 1])
                    with col1:
                        st.caption(f"Importance: **{mem['importance_score']}** | Source Topic: `{mem['source_thread_title']}`")
                    with col2:
                        if st.button("❌", key=f"del-mem-{mem['id']}", help="Delete fact"):
                            api_delete(f"/memory/{mem['id']}")
                            st.rerun()
        else:
            st.info("Memory bank empty! Chat with the assistant to let it extract facts automatically in the background.")

# 📧 MailAI — AI-Powered Email Client

A full-stack, real-time sync email application built with **React**, **Node.js/Express**, and **PostgreSQL**.
Features an integrated **Google Gemini AI Assistant** that operates as a UI co-pilot, controlling the client dynamically using natural language.

---

## 🚀 Key Features

- **OAuth 2.0 Integration**: Sign in securely with your Google Account.
- **Dynamic AI Control (Gemini 1.5 Flash)**:
  - *"Send email to bob@example.com with subject Hello"* ➔ Navigation opens ➔ Form fills up automatically ➔ Email sends.
  - *"Show me emails from last 7 days"* ➔ Inbox filters down instantly.
  - *"Open latest email from Alice"* ➔ Searches Alice ➔ Navigates directly into details view.
  - *"Reply to this"* ➔ Auto-populates thread replies contextually.
- **Premium Dark UI**: Built with a sleek dark glassmorphism layout, smooth transitions, and visual execution pipelines.
- **Real-Time Sync**: Syncs unread counts and message updates every 30 seconds automatically.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Zustand, Axios, Lucide Icons, Date-fns.
- **Backend**: Node.js, Express, TypeScript, Google APIs Client, Generative Language API.
- **Database**: PostgreSQL (PG connection pool).

---

## 📋 Getting Started

### 1. Prerequisites
- **Node.js** v18+
- **PostgreSQL** running locally
- **Google Cloud Console Project**:
  - Enable **Gmail API** and **Generative Language API** (Gemini).
  - Create OAuth 2.0 Credentials (Web Application) with redirect URI: `http://localhost:3001/auth/google/callback`.
- **Gemini API Key**: Retrieve from [Google AI Studio](https://aistudio.google.com/).

---

### 2. Installation & Setup

1. Clone the repository and navigate to the project directory:
   ```bash
   cd mail-app
   ```

2. Setup Backend Environment:
   Create `backend/.env` based on `backend/.env.example`:
   ```bash
   cp backend/.env.example backend/.env
   # Open backend/.env and populate your actual credentials
   ```

3. Setup Frontend Environment:
   Create `frontend/.env` based on `frontend/.env.example`:
   ```bash
   cp frontend/.env.example frontend/.env
   ```

4. Install dependencies:
   ```bash
   # From root folder
   cd backend && npm install
   cd ../frontend && npm install
   ```

---

### 3. Database Migration

1. Create a database in PostgreSQL:
   ```bash
   createdb mail_app
   ```
2. Run database migrations to construct the tables:
   ```bash
   cd backend
   npm run db:migrate
   ```

---

### 4. Running the Application

1. **Start Backend Server**:
   ```bash
   cd backend
   npm run dev
   ```
   The backend will start at `http://localhost:3001`.

2. **Start Frontend Client**:
   ```bash
   cd frontend
   npm start
   ```
   The frontend will open in your browser at `http://localhost:3000`.

---

## 🤖 Verification Checklist for Evaluators

1. **OAuth Sign-in**: Click "Sign in with Google" to authorize and load your inbox.
2. **AI Compose**: Type: *"Send an email to user@example.com with subject Test and body Hello"* in the chat panel. Look at the form populating and automatically sending.
3. **AI Search/Filter**: Type: *"Show me unread emails"* or *"Show me emails from last 7 days"*. The inbox will dynamically filter.
4. **AI Details Navigation**: Type: *"Open latest email from [SenderName]"*. The email will be loaded and displayed in details view.
5. **Contextual Reply**: While reading an email, type: *"Reply to this"*. The compose box opens pre-populated with their email address and subject header.
6. **Trash**: Click the Delete button inside any email details view to move it to trash.
7. **Reply UI**: Click the Reply button manually inside any email to open compose view pre-filled.

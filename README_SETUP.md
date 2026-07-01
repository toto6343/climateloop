# ClimateLoop Setup Guide

This project consists of a FastAPI backend and a Next.js frontend.

## Prerequisites
- Python 3.10+
- Node.js 18+
- npm or yarn

## Backend Setup
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Initialize the database:
   ```bash
   python -m models.database
   ```
5. Run the server:
   ```bash
   uvicorn main:app --reload
   ```

## Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

### Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env` and fill in your API keys:
- **`GEMINI_API_KEY`**: For the AI Assistant (Get from Google AI Studio).

### Frontend (`frontend/.env.local`)
Create a `.env.local` file in the `frontend` directory with the following content.
- **`NEXT_PUBLIC_API_URL`**: The URL of the running backend server.
  ```
  NEXT_PUBLIC_API_URL=http://localhost:8000
  ```

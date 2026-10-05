import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import './index.css'

// The boundary wraps App so a render error shows the fallback instead of
// leaving a blank page.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary component="App">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

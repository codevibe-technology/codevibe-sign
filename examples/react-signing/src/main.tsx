import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@codevibe/sign-react/styles.css';
import './page.css';
import { SigningPage } from './SigningPage';

const token = new URLSearchParams(window.location.search).get('token');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {token ? <SigningPage token={token} /> : <p className="notice">Open your signing link.</p>}
  </StrictMode>,
);

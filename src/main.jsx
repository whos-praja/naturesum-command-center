import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from "@clerk/clerk-react";
import "./index.css";
import App from "./App.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import { LiveDataProvider } from "./contexts/LiveDataContext.jsx";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const AUTH_ENABLED = Boolean(PUBLISHABLE_KEY);

// Tree of routes used inside the BrowserRouter. Kept identical for both
// the auth-enabled and auth-disabled branches so refresh-on-deep-link works.
const Routed = () => (
  <Routes>
    <Route path="/" element={<App />} />
    <Route path="/:section" element={<App />} />
    <Route path="/:section/:subsection" element={<App />} />
    <Route path="*" element={<App />} />
  </Routes>
);

if (!AUTH_ENABLED) {
  // Local dev fallback: no Clerk key set yet. App runs without a login
  // gate so the team can keep building. Adding VITE_CLERK_PUBLISHABLE_KEY
  // to .env (locally) or to Vercel (in prod) flips on the auth wall.
  // eslint-disable-next-line no-console
  console.warn(
    "[naturesum] VITE_CLERK_PUBLISHABLE_KEY is not set — running without auth. " +
      "Add it to .env to enable the sign-in wall."
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LiveDataProvider>
      <BrowserRouter>
        {AUTH_ENABLED ? (
          <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/sign-in">
            <Routes>
              <Route path="/sign-in/*" element={<SignInPage />} />
              <Route
                path="/*"
                element={
                  <>
                    <SignedIn>
                      <Routed />
                    </SignedIn>
                    <SignedOut>
                      <RedirectToSignIn />
                    </SignedOut>
                  </>
                }
              />
            </Routes>
          </ClerkProvider>
        ) : (
          <Routed />
        )}
      </BrowserRouter>
    </LiveDataProvider>
  </StrictMode>
);

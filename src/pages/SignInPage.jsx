import { SignIn } from "@clerk/clerk-react";

// Standalone sign-in route at /sign-in. Uses Clerk's pre-built component
// inside a centered card. Styling is tuned via the `appearance` prop to
// stay close to the Naturesum "Quiet Ops" palette.
const SignInPage = () => (
  <div className="signin-shell">
    <div className="signin-brand">
      <div className="signin-mark">N</div>
      <div>
        <div className="signin-name">Naturesum</div>
        <div className="signin-sub">Command Center</div>
      </div>
    </div>

    <SignIn
      routing="path"
      path="/sign-in"
      signUpUrl="/sign-in"
      forceRedirectUrl="/"
      appearance={{
        variables: {
          colorPrimary: "#2F5E47",
          colorText: "#1A1F1B",
          colorTextSecondary: "#6B7066",
          colorBackground: "#FFFFFF",
          colorInputBackground: "#FAF8F2",
          colorInputText: "#1A1F1B",
          fontFamily: "DM Sans, system-ui, -apple-system, sans-serif",
          borderRadius: "6px",
        },
        elements: {
          card: { boxShadow: "0 1px 0 rgba(26,31,27,0.04), 0 2px 6px rgba(26,31,27,0.06)" },
          headerTitle: { fontSize: "18px", letterSpacing: "-0.01em" },
          headerSubtitle: { fontSize: "12.5px" },
          formButtonPrimary: {
            backgroundColor: "#2F5E47",
            borderColor: "#1F4030",
            fontWeight: 500,
            "&:hover": { backgroundColor: "#1F4030" },
          },
        },
      }}
    />

    <div className="signin-footnote">
      Internal tool · access restricted to allowlisted Naturesum team members.
    </div>
  </div>
);

export default SignInPage;

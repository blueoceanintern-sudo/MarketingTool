import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "Your Google account is not authorised to access this tool. Contact an admin to request access.",
  OAuthSignin: "Could not start the Google sign-in flow. Please try again.",
  OAuthCallback: "Something went wrong during Google sign-in. Please try again.",
  Default: "Sign-in failed. Please try again or contact an admin.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/campaigns");

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default) : null;

  return (
    <div className="min-h-screen flex">
      {/* Left panel — brand hero */}
      <div
        className="hidden min-h-screen lg:flex lg:w-[68%] xl:w-[70%] relative flex-col overflow-hidden select-none"
        style={{ backgroundColor: "#021745" }}
      >
        {/* Dot-grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Glow blobs */}
        <div
          className="absolute -top-40 -right-40 w-130 h-130 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(75,107,181,0.35) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute -bottom-32 -left-20 w-105 h-105 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(75,107,181,0.2) 0%, transparent 65%)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between h-full p-12 lg:p-14">
          {/* Brand mark */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <span className="text-white font-bold text-[15px] leading-none">B</span>
            </div>
            <span className="text-white font-bold text-[18px] tracking-tight">BlueOcean</span>
          </div>

          {/* Hero copy */}
          <div className="flex flex-col gap-5">
            <h2
              className="text-white font-bold leading-[1.15] max-w-105"
              style={{ fontSize: "clamp(26px, 3vw, 40px)" }}
            >
              Reach the right businesses, at the right time.
            </h2>
            <p
              className="text-[15px] leading-relaxed max-w-90"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Automated B2B outreach across Singapore, Australia, and the US — from
              discovery to delivery.
            </p>

            {/* Stat chips */}
            <div className="flex gap-8 mt-2">
              {[
                { label: "Markets", value: "3" },
                { label: "Max sends / week", value: "2×" },
                { label: "AI model", value: "Haiku 4.5" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col gap-0.5">
                  <span className="text-white font-bold text-2xl">{s.value}</span>
                  <span
                    className="text-[11px]"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            Internal tool · BlueOcean © 2026
          </p>
        </div>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex-1 flex items-center justify-center bg-white px-8 py-16">
        <div className="w-full max-w-85 flex flex-col gap-7">
          {/* Mobile brand */}
          <div className="lg:hidden flex flex-col items-center gap-1 mb-2">
            <h1 className="text-[22px] font-bold text-primary">BlueOcean</h1>
            <p className="text-[13px] text-grey-500">Marketing Automation</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-[24px] font-bold text-primary">Sign in</h1>
            <p className="text-[14px] text-grey-500">
              Use your BlueOcean team Google account.
            </p>
          </div>

          {errorMessage && (
            <div className="bg-danger-bg border border-danger/20 rounded-lg px-4 py-3 text-[13px] text-danger">
              {errorMessage}
            </div>
          )}

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/campaigns" }, { prompt: "select_account" });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-grey-200 rounded-xl text-[14px] font-medium text-foreground hover:bg-grey-50 transition-colors cursor-pointer"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <p className="text-[11px] text-grey-400 text-center">
            Access is restricted to authorised team members only.
          </p>
        </div>
      </div>
    </div>
  );
}

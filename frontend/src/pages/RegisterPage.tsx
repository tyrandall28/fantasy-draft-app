import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth";
import { errorMessage } from "../lib/errors";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(email, username, password);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-ink-900">
      {/* Left hero panel */}
      <div className="hidden lg:flex lg:flex-1 flex-col justify-center px-16 bg-gradient-to-br from-[#1a1a18] to-[#121211] border-r border-ink-700">
        <div className="max-w-lg">
          <h1 className="text-5xl font-extrabold text-chalk leading-tight mb-4">
            Fantasy <span className="text-accent">Draft</span>
          </h1>
          <p className="text-xl text-chalk-dim mb-8 leading-relaxed">
            Build your custom rankings, draft with friends in real time, and dominate your league.
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-chalk-dim">Custom Rankings</p>
                <p className="text-sm text-chalk-mut">Create personalized player rankings from expert sources</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-rise/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-rise" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-chalk-dim">Live Snake Drafts</p>
                <p className="text-sm text-chalk-mut">Draft with up to 10 teams using real-time WebSocket boards</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-caution/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-caution" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-chalk-dim">AI Insights</p>
                <p className="text-sm text-chalk-mut">Player analysis and draft advice powered by AI (coming soon)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          {/* Mobile-only branding */}
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-3xl font-extrabold text-chalk">
              Fantasy <span className="text-accent">Draft</span>
            </h1>
            <p className="text-chalk-mut mt-2">Draft smarter. Win bigger.</p>
          </div>

          <div className="bg-ink-700 border border-ink-600 rounded-xl p-8">
            <h2 className="text-xl font-bold text-chalk mb-6">Create your account</h2>

            {error && (
              <div className="bg-fall/10 border border-fall/20 text-fall p-3 rounded-lg mb-4 text-sm whitespace-pre-line">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-chalk-dim mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 panel text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-colors"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chalk-dim mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 panel text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-colors"
                  placeholder="Pick a username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-chalk-dim mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2.5 panel text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-colors"
                  placeholder="At least 6 characters"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5 font-semibold mt-2"
              >
                {loading ? "Creating account..." : "Create Account"}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-chalk-mut">
              Already have an account?{" "}
              <Link to="/login" className="text-accent hover:text-accent font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

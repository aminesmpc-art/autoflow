"use client";

import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const { register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const result = await register(email, password);
    if (result.success) {
      router.push("/extractor");
    } else {
      setError(result.error || "Failed to register.");
    }
    
    setIsLoading(false);
  };

  return (
    <div className="container" style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: "400px", width: "100%", padding: "2rem", background: "rgba(255, 255, 255, 0.03)", borderRadius: "16px", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
        <h1 style={{ marginBottom: "1.5rem", textAlign: "center" }}>Sign Up</h1>
        
        {error && (
          <div style={{ padding: "1rem", marginBottom: "1rem", background: "rgba(255, 0, 0, 0.1)", border: "1px solid rgba(255, 0, 0, 0.2)", borderRadius: "8px", color: "#ff8080" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Email</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
            />
          </div>
          <button type="submit" disabled={isLoading} className="btn btn-primary" style={{ width: "100%", marginTop: "1rem", padding: "0.75rem" }}>
            {isLoading ? "Signing up..." : "Sign Up"}
          </button>
        </form>

        <p style={{ marginTop: "1.5rem", textAlign: "center", color: "var(--text-secondary)" }}>
          Already have an account? <Link href="/login" style={{ color: "var(--primary-light)" }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}

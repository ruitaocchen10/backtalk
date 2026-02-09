"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Sign in with existing account
  async function handleSignIn() {
    setLoading(true);
    setError("");

    // signInWithPassword checks credentials against Supabase Auth.
    // If valid, it returns a session (JWT + refresh token) that the
    // Supabase client automatically stores in localStorage.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  // Create a new account
  async function handleSignUp() {
    setLoading(true);
    setError("");

    // signUp creates a new user in Supabase Auth's users table.
    // Since we disabled email confirmation, the user is immediately
    // signed in and gets a session back.
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-4 p-8">
        <h1 className="text-2xl font-bold text-center">BackTalk</h1>
        <p className="text-center text-gray-500">Sign in to continue</p>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded-md"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded-md"
        />

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
        >
          Sign In
        </button>
        <button
          onClick={handleSignUp}
          disabled={loading}
          className="w-full py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50"
        >
          Sign Up
        </button>
      </div>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

interface AuthState {
  loading: boolean
  session: Session | null
  email: string | null
  userId: string | null
  isLeader: boolean
  isAdmin: boolean
  /** The name others find you by (null until you've added it). */
  displayName: string | null
}

interface AuthContextValue extends AuthState {
  /** Re-check leader status and name (after accepting an invite or saving your name). */
  refresh: () => Promise<void>
}

const signedOut: AuthState = {
  loading: false,
  session: null,
  email: null,
  userId: null,
  isLeader: false,
  isAdmin: false,
  displayName: null,
}

const AuthContext = createContext<AuthContextValue>({ ...signedOut, loading: true, refresh: async () => {} })

async function loadState(session: Session | null): Promise<AuthState> {
  if (!session) return signedOut
  const email = session.user.email?.toLowerCase() ?? null
  const [leader, admin, profile] = await Promise.all([
    supabase.rpc('is_leader'),
    supabase.rpc('is_app_admin'),
    email ? supabase.from('profiles').select('display_name').eq('email', email).maybeSingle() : Promise.resolve({ data: null }),
  ])
  // Make sure everyone who signs in has a profile row to put their name on.
  if (email && !profile.data) {
    await supabase.from('profiles').upsert({ email, user_id: session.user.id }, { onConflict: 'email', ignoreDuplicates: true })
  }
  return {
    loading: false,
    session,
    email,
    userId: session.user.id,
    isLeader: leader.data === true,
    isAdmin: admin.data === true,
    displayName: (profile.data as { display_name: string | null } | null)?.display_name ?? null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...signedOut, loading: true })

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setState(await loadState(data.session))
  }, [])

  useEffect(() => {
    let cancelled = false
    const apply = async (session: Session | null) => {
      const next = await loadState(session)
      if (!cancelled) setState(next)
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: supabase-js warns against awaiting its own calls inside this callback.
        setTimeout(() => apply(session), 0)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={{ ...state, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

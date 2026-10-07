import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

interface AuthState {
  loading: boolean
  session: Session | null
  email: string | null
  isLeader: boolean
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, email: null, isLeader: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, session: null, email: null, isLeader: false })

  useEffect(() => {
    let cancelled = false

    async function apply(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ loading: false, session: null, email: null, isLeader: false })
        return
      }
      const { data } = await supabase.rpc('is_leader')
      if (!cancelled) {
        setState({ loading: false, session, email: session.user.email ?? null, isLeader: data === true })
      }
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

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

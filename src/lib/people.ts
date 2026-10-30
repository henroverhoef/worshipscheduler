import { supabase } from './supabase'

/** You or one of your co-leaders. */
export interface Person {
  email: string
  name: string | null
  me: boolean
  since: string | null
}

export interface InviteInfo {
  inviter_email: string
  inviter_name: string | null
  invitee_email: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
}

export interface MyInvite {
  token: string
  inviter_email: string
  inviter_name: string | null
  created_at: string
}

export interface SentInvite {
  token: string
  invitee_email: string
  created_at: string
  expires_at: string
}

export const personLabel = (p: { name: string | null; email: string }) => p.name || p.email

export function matchesPerson(p: { name: string | null; email: string }, query: string) {
  const q = query.trim().toLowerCase()
  return !q || p.email.includes(q) || (p.name ?? '').toLowerCase().includes(q)
}

export async function fetchMyPeople(): Promise<Person[]> {
  const { data, error } = await supabase.rpc('my_people')
  if (error) throw error
  return (data ?? []) as Person[]
}

/** Names for the emails you're allowed to see (yourself, co-leaders, leaders of your sets). */
export async function fetchNames(emails: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(emails.filter(Boolean))]
  if (!unique.length) return {}
  const { data } = await supabase.from('profiles').select('email, display_name').in('email', unique)
  const out: Record<string, string> = {}
  for (const r of data ?? []) if (r.display_name) out[r.email as string] = r.display_name as string
  return out
}

export async function saveMyName(email: string, userId: string, name: string) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ email, user_id: userId, display_name: name.trim(), updated_at: new Date().toISOString() }, { onConflict: 'email' })
  if (error) throw error
}

export function inviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`
}

export function inviteMessage(fromName: string | null, token: string) {
  return `${fromName || 'A worship leader'} invited you to lead worship sets together on Worship Sets. Open this link and sign in (or create an account) with this email address to accept:\n\n${inviteUrl(token)}`
}

export async function createInvite(email: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', { p_email: email })
  if (error) throw error
  return data as string
}

export async function getInvite(token: string): Promise<InviteInfo | null> {
  const { data, error } = await supabase.rpc('get_invite', { p_token: token })
  if (error) throw error
  return (data as InviteInfo | null) ?? null
}

export async function acceptInvite(token: string) {
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) throw error
}

export async function declineInvite(token: string) {
  const { error } = await supabase.rpc('decline_invite', { p_token: token })
  if (error) throw error
}

export async function fetchMyInvites(): Promise<MyInvite[]> {
  const { data, error } = await supabase.rpc('my_invites')
  if (error) throw error
  return (data ?? []) as MyInvite[]
}

export async function fetchSentInvites(me: string): Promise<SentInvite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('token, invitee_email, created_at, expires_at')
    .eq('inviter_email', me)
    .is('accepted_at', null)
    .is('declined_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SentInvite[]
}

export async function cancelInvite(token: string) {
  const { error } = await supabase.from('invites').delete().eq('token', token)
  if (error) throw error
}

/**
 * Stop being co-leaders: ends the pair and takes each of you off the other's sets
 * (sets either of you created stay with their creator).
 */
export async function endCoLeadership(me: string, other: string) {
  const [a, b] = me < other ? [me, other] : [other, me]
  const { data: sets } = await supabase.from('events').select('id, created_by_email').in('created_by_email', [me, other])
  const mine = (sets ?? []).filter((s) => s.created_by_email === me).map((s) => s.id as string)
  const theirs = (sets ?? []).filter((s) => s.created_by_email === other).map((s) => s.id as string)
  if (mine.length) await supabase.from('event_leaders').delete().eq('email', other).in('event_id', mine)
  if (theirs.length) await supabase.from('event_leaders').delete().eq('email', me).in('event_id', theirs)
  const { error } = await supabase.from('collaborators').delete().match({ a, b })
  if (error) throw error
}

// Remembers an invite link opened before signing in, so it can be picked up afterwards.
const PENDING_INVITE = 'ws.pendingInvite'
export function rememberInviteToken(token: string) {
  try {
    localStorage.setItem(PENDING_INVITE, token)
  } catch {
    /* ignore */
  }
}
export function takeInviteToken(): string | null {
  try {
    const t = localStorage.getItem(PENDING_INVITE)
    localStorage.removeItem(PENDING_INVITE)
    return t
  } catch {
    return null
  }
}

export interface AdminOverview {
  totals: {
    leaders: number
    pairs: number
    sets: number
    upcoming_sets: number
    kept_sets: number
    songs: number
    pdf_bytes: number
    open_invites: number
    active_7d: number
  }
  leaders: {
    email: string
    name: string | null
    added_at: string
    last_sign_in: string | null
    sets: number
    songs: number
    is_admin: boolean
    co_leaders: string[]
  }[]
  invites: { token: string; inviter: string; invitee_email: string; created_at: string; expires_at: string }[]
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc('admin_overview')
  if (error) throw error
  return data as AdminOverview
}

export async function adminRemoveLeader(email: string) {
  const { error } = await supabase.rpc('admin_remove_leader', { p_email: email })
  if (error) throw error
}

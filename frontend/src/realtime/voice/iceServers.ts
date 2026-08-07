import { API_BASE_URL } from '@/shared/api/client'

export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

interface IceConfigResponse {
  iceServers: RTCIceServer[]
  ttlSeconds: number
}

export async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/voice/ice`)
    if (!response.ok) return FALLBACK_ICE_SERVERS
    const config = (await response.json()) as IceConfigResponse
    if (!Array.isArray(config.iceServers) || config.iceServers.length === 0) {
      return FALLBACK_ICE_SERVERS
    }
    return config.iceServers
  } catch {
    return FALLBACK_ICE_SERVERS
  }
}

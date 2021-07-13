import Vue from 'vue'
import Hookable from 'hookable'
import destr from 'destr'
import reqURL from 'requrl'
import { joinURL } from 'ufo'
import type { NuxtHTTPInstance } from '@nuxt/http'
import type { NuxtCookies } from 'cookie-universal-nuxt'
import type {
  NuxtStrapiEmailData,
  NuxtStrapiLoginData,
  NuxtStrapiLoginResult, NuxtStrapiQueryParams,
  NuxtStrapiRegistrationData, NuxtStrapiResetPasswordData,
  NuxtStrapiUser,
  StrapiOptions
} from './types'
import { getExpirationDate, isExpired } from './utils'

export class Strapi extends Hookable {
  private state: { user: null | any }
  $cookies: NuxtCookies
  $http: NuxtHTTPInstance
  options: StrapiOptions
  $refreshTimer: any

  constructor (ctx, options: StrapiOptions) {
    super()

    ctx.$config = ctx.$config || {} // fallback for Nuxt < 2.13
    const runtimeConfig = ctx.$config.strapi || {}
    this.$cookies = ctx.app.$cookies
    this.$http = ctx.$http.create({})
    this.$refreshTimer = null
    this.options = options

    this.state = Vue.observable({ user: null })

    this.syncToken()
    const url = runtimeConfig.url || this.options.url
    if (process.server && ctx.req && url.startsWith('/')) {
      this.$http.setBaseURL(joinURL(reqURL(ctx.req), url))
    } else {
      this.$http.setBaseURL(url)
    }
    this.$http.onError((err) => {
      if (!err.response) {
        this.callHook('error', err)
        return
      }

      const { response: { data: { message: msg } } }: any = err

      let message
      if (Array.isArray(msg)) {
        message = msg[0].messages[0].message
      } else if (typeof msg === 'object' && msg !== null) {
        message = msg.message
      } else {
        message = msg
      }

      err.message = message;
      (err as any).original = (err.response as any).data
      this.callHook('error', err)
    })
  }

  get user (): NuxtStrapiUser {
    return this.state.user
  }

  set user (user) {
    Vue.set(this.state, 'user', user)
  }

  async register (data: NuxtStrapiRegistrationData): Promise<NuxtStrapiLoginResult> {
    this.clearToken()
    const { user, jwt, refreshToken } = await this.$http.$post<any>('/auth/local/register', data)
    this.setRefreshToken(refreshToken)
    this.setToken(jwt)
    await this.setUser(user)
    return { user, jwt, refreshToken }
  }

  async login (data: NuxtStrapiLoginData): Promise<NuxtStrapiLoginResult> {
    this.clearToken()
    const { user, jwt, refreshToken } = await this.$http.$post<any>('/auth/local', data)
    this.setRefreshToken(refreshToken)
    this.setToken(jwt)
    await this.setUser(user)
    return { user, jwt, refreshToken }
  }

  forgotPassword (data: NuxtStrapiEmailData): Promise<unknown> {
    this.clearToken()
    return this.$http.$post('/auth/forgot-password', data)
  }

  async resetPassword (data: NuxtStrapiResetPasswordData): Promise<NuxtStrapiLoginResult> {
    this.clearToken()
    const { user, jwt, refreshToken } = await this.$http.$post<any>('/auth/reset-password', data)
    this.setRefreshToken(refreshToken)
    this.setToken(jwt)
    await this.setUser(user)
    return { user, jwt, refreshToken }
  }

  sendEmailConfirmation (data: NuxtStrapiEmailData): Promise<unknown> {
    return this.$http.$post('/auth/send-email-confirmation', data)
  }

  async logout (): Promise<void> {
    await this.setUser(null)
    this.clearToken()
    this.clearRefreshToken()
  }

  async fetchUser (): Promise<NuxtStrapiUser> {
    const jwt = this.syncToken()
    if (!jwt) {
      return null
    }

    try {
      const user = await this.findOne('users', 'me')
      await this.setUser(user)
    } catch (e) {
      this.clearToken()
    }

    return this.user
  }

  async refreshToken (): Promise<NuxtStrapiLoginResult> {
    try {
      this._stopTokenRefreshTimer()
      const refreshToken = this.getRefreshToken()
      if (!refreshToken) {
        return
      }
      const { user, jwt } = await this.$http.$post<any>('/auth/token', { refreshToken }, { headers: { Authorization: '' } })
      this.clearToken()
      this.setToken(jwt)
      await this.setUser(user)

      return { user, jwt, refreshToken }
    } catch (err) {
      this.clearToken()
    }
  }

  async setUser (user): Promise<void> {
    this.user = user
    await this.callHook('userUpdated', user)
  }

  find<T = any, E = string> (entity: E, searchParams?: NuxtStrapiQueryParams): Promise<T> {
    return this.$http.$get<T>(`/${entity}`, { searchParams })
  }

  count<T = any, E = string> (entity: E, searchParams?: NuxtStrapiQueryParams): Promise<T> {
    return this.$http.$get<T>(`/${entity}/count`, { searchParams })
  }

  findOne<T = any, E = string> (entity: E, id: string): Promise<T> {
    return this.$http.$get<T>(`/${entity}/${id}`)
  }

  create<T = any, E = string> (entity: E, data: NuxtStrapiQueryParams): Promise<T> {
    return this.$http.$post<T>(`/${entity}`, data)
  }

  update<T = any, E = string> (entity: E, id: string, data: NuxtStrapiQueryParams): Promise<T> {
    if (typeof id === 'object') {
      data = id
      id = undefined
    }

    const path = [entity, id].filter(Boolean).join('/')
    return this.$http.$put(`/${path}`, data)
  }

  delete<T = any, E = string> (entity: E, id: string): Promise<T> {
    const path = [entity, id].filter(Boolean).join('/')
    return this.$http.$delete(`/${path}`)
  }

  graphql<T = any> (query): Promise<T> {
    return this.$http.$post<{ data: T }>('/graphql', query).then(res => res.data)
  }

  private getClientStorage () {
    const storageType = this.options.expires === 'session' ? 'sessionStorage' : 'localStorage'

    if (process.client && typeof window[storageType] !== 'undefined') {
      return window[storageType]
    }
    return null
  }

  getToken (): string {
    let token
    const clientStorage = this.getClientStorage()
    if (clientStorage) {
      const session = destr(clientStorage.getItem(this.options.key))
      if (session && !isExpired(session.expires)) {
        token = session.token
      }
    }
    if (!token) {
      token = this.$cookies.get(this.options.key)
    }
    return token
  }

  setToken (token: string): void {
    const expires = this.options.expires === 'session' ? undefined : getExpirationDate(this.options.expires)

    const clientStorage = this.getClientStorage()
    clientStorage && clientStorage.setItem(this.options.key, JSON.stringify({ token, expires }))
    this.$cookies.set(this.options.key, token, {
      ...this.options.cookie,
      expires
    })
    this.$http.setToken(token, 'Bearer')
    this._startTokenRefreshTimer()
  }

  clearToken (): void {
    this.$http.setToken(false)
    const clientStorage = this.getClientStorage()
    clientStorage && clientStorage.removeItem(this.options.key)
    this.$cookies.remove(this.options.key)
  }

  private syncToken (jwt?) {
    if (!jwt) {
      jwt = this.getToken()
    }
    if (jwt) {
      this.setToken(jwt)
    } else {
      this.clearToken()
    }
    return jwt
  }

  getRefreshToken (): string {
    let refreshToken
    const clientStorage = this.getClientStorage()
    const refreshKey = this._refreshTokenKey(this.options.key)
    if (clientStorage) {
      refreshToken = clientStorage.getItem(refreshKey)
    }

    return refreshToken
  }

  setRefreshToken (token: string): void {
    const clientStorage = this.getClientStorage()
    const refreshKey = this._refreshTokenKey(this.options.key)
    clientStorage && clientStorage.setItem(refreshKey, token)
  }

  clearRefreshToken (): void {
    this._stopTokenRefreshTimer()
    const clientStorage = this.getClientStorage()
    const refreshKey = this._refreshTokenKey(this.options.key)
    clientStorage && clientStorage.removeItem(refreshKey)
  }

  _refreshTokenKey (key) {
    return [key, 'refresh'].join('_')
  }

  _startTokenRefreshTimer () {
    if (!this.options.autoRefreshToken) {
      return
    }
    if (this.options.expires !== 'session') {
      if (this.$refreshTimer) {
        clearTimeout(this.$refreshTimer)
        this.$refreshTimer = null
      }

      let expires = this.options.expires
      if (expires > 10000) {
        expires = expires - 10000
      } else {
        expires = expires / 2
      }

      this.$refreshTimer = setTimeout(() => {
        this.$refreshTimer = null
        this.refreshToken()
      }, expires)
    }
  }

  _stopTokenRefreshTimer () {
    if (this.$refreshTimer) {
      clearTimeout(this.$refreshTimer)
      this.$refreshTimer = null
    }
  }
}

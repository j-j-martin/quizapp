import { github, lucia } from '@/lib/auth'
import { db } from '@/lib/db'
import { cookies } from 'next/headers'
import { OAuth2RequestError } from 'arctic'
import { generateId } from 'lucia'

import type { DatabaseUser } from '@/lib/db'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const storedState = cookies().get('github_oauth_state')?.value ?? null
  if (!code || !state || !storedState || state !== storedState) {
    return new Response(null, {
      status: 400,
    })
  }
  
  try {
    const tokens = await github.validateAuthorizationCode(code)
    const githubUserResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    })
    const githubUser: GitHubUser = await githubUserResponse.json()
    
    let existingUser : DatabaseUser | undefined = undefined
    try {
      existingUser = (await db.user.findFirst({
      where: {
        githubId: githubUser.id,
      },
    })) as DatabaseUser | undefined
    } catch(e) {
      console.log("error fetching user")
    }
      
    if (existingUser) {
      const session = await lucia.createSession(existingUser.id, {})
      const sessionCookie = lucia.createSessionCookie(session.id)
      cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/',
        },
      })
    }
    
    const userId = generateId(15)
    try {
      await db.user.create({
      data: {
        id: userId,
        githubId: githubUser.id,
        username: githubUser.login,
      },
    })
    } catch (e) {
      console.log(e)
    }
    
    const session = await lucia.createSession(userId, {})
    const sessionCookie = lucia.createSessionCookie(session.id)
    cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
      },
    })
  } catch (e) {
    if (e instanceof OAuth2RequestError && e.message === 'bad_verification_code') {
      // invalid code
      return new Response(null, {
        status: 400,
      })
    }
    return new Response(null, {
      status: 500,
    })
  }
}

interface GitHubUser {
  id: number
  login: string
  email: string
}

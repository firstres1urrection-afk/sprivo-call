export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const phone = req.body?.phone
  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' })
  }

  const apiKey = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET
  const from = process.env.SOLAPI_FROM

  const to = String(phone).replace(/-/g, '')
  const text = '현재 해외 체류 중입니다. 문자로 연락 부탁드립니다.'

  console.log('📞 전화 감지:', phone)

  const { createHmac } = await import('crypto')
  const date = new Date().toISOString()
  const salt = Math.random().toString(36).slice(2, 14)
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex')

  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

  try {
    const resp = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({
        messages: [
          {
            to,
            from,
            text,
          },
        ],
      }),
    })

    const data = await resp.json()

    console.log('📩 문자 결과:', data)

    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: data?.errorMessage || data?.message || data || 'SOLAPI error',
      })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('🚨 SOLAPI 호출 실패:', err)
    return res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
}

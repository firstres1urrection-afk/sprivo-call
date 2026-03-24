export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const phone = req.body?.phone

  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' })
  }

  console.log('📞 전화 감지:', phone)

  const apiKey = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET
  const from = process.env.SOLAPI_FROM

  const text = '현재 해외 체류 중입니다. 문자로 연락 부탁드립니다.'

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  try {
    const resp = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        messages: [
          {
            to: phone,
            from: from,
            text: text,
          },
        ],
      }),
    })

    const data = await resp.json()

    console.log('📩 문자 결과:', data)

    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: data?.message || 'SOLAPI error',
      })
    }

    return res.status(200).json({
      success: true,
    })

  } catch (err) {
    console.error('🚨 SOLAPI 호출 실패:', err)
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
    })
  }
}

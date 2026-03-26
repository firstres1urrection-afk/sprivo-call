export default async function handler(req, res) {
  const requestLogId = 'log_' + Date.now()

  const send = (statusCode, payload) => {
    const {
      success = false,
      status = 'error',
      reason = '',
      logId = null,
      sentAt = null,
      shouldSendReply = false,
    } = payload || {}

    return res.status(statusCode).json({
      success,
      status,
      reason,
      logId,
      sentAt,
      shouldSendReply,
    })
  }

  if (req.method !== 'POST') {
    return send(405, {
      success: false,
      status: 'error',
      reason: 'METHOD_NOT_ALLOWED',
      logId: null,
      sentAt: null,
      shouldSendReply: false,
    })
  }

  const phone = req.body?.phone

  if (!phone) {
    return send(400, {
      success: false,
      status: 'error',
      reason: 'INVALID_REQUEST',
      logId: null,
      sentAt: null,
      shouldSendReply: false,
    })
  }

  const apiKey = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET
  const from = process.env.SOLAPI_FROM

  const logId = requestLogId
  const to = String(phone).replace(/-/g, '')
  const text = req.body?.message || '현재 해외 체류 중입니다. 문자로 연락 부탁드립니다.'

  console.log('📞 전화 감지:', phone, 'logId:', logId)

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

    console.log('📩 문자 결과:', { logId, data })

    if (!resp.ok) {
      return send(resp.status, {
        success: false,
        status: 'fail',
        reason: 'SMS_PROVIDER_ERROR',
        logId,
        sentAt: null,
        shouldSendReply: true,
      })
    }

    return send(200, {
      success: true,
      status: 'success',
      reason: '',
      logId,
      sentAt: date,
      shouldSendReply: true,
    })
  } catch (err) {
    console.error('🚨 서버 예외:', err, 'logId:', logId)
    return send(500, {
      success: false,
      status: 'error',
      reason: 'SERVER_INTERNAL_ERROR',
      logId,
      sentAt: null,
      shouldSendReply: false,
    })
  }
}

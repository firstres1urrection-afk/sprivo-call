export default async function handler(req, res) {
  const now = new Date().toISOString();
  const logId = `log_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  const maskPhone = (raw) => {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length <= 4) return "*".repeat(digits.length);
    return "*".repeat(digits.length - 4) + digits.slice(-4);
  };

  const normalizePhone = (raw) => {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;
    if (digits.startsWith("82") && digits.length >= 11) {
      digits = "0" + digits.slice(2);
    }
    if (digits.length === 10 || digits.length === 11) return digits;
    return null;
  };

  const createResponse = ({
    success,
    status,
    reason,
    groupId,
    providerStatus,
    sentAt,
    shouldSendReply = true,
  }) => ({
    success,
    status,
    reason,
    logId,
    groupId: groupId ?? null,
    providerStatus: providerStatus ?? null,
    sentAt: sentAt ?? now,
    shouldSendReply,
  });

  if (req.method !== "POST") {
    return res.status(405).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "METHOD_NOT_ALLOWED",
        shouldSendReply: false,
      })
    );
  }

  const rawPhone = req.body?.phone ?? req.body?.number;
  const mode = req.body?.mode ?? "unknown";
  const message =
    req.body?.message ?? "현재 해외 체류 중입니다. 문자로 연락 부탁드립니다.";

  console.log(`[SPRIVO_SMS][${logId}][${now}] request received`, {
    hasPhone: !!req.body?.phone,
    hasNumber: !!req.body?.number,
    mode,
    messageLen: message.length,
    messagePreview: `${message.slice(0, 20)}${
      message.length > 20 ? "..." : ""
    }`,
    rawPhoneMasked: maskPhone(rawPhone),
  });

  const targetNumber = normalizePhone(rawPhone);
  if (!targetNumber) {
    console.warn(`[SPRIVO_SMS][${logId}] phone normalization failed`, {
      rawPhoneMasked: maskPhone(rawPhone),
    });
    return res.status(400).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "PHONE_NORMALIZATION_FAILED",
        shouldSendReply: false,
      })
    );
  }

  console.log(`[SPRIVO_SMS][${logId}] normalized number`, {
    targetNumberMasked: maskPhone(targetNumber),
  });

  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = process.env.SOLAPI_FROM;

  if (!apiKey || !apiSecret || !from) {
    console.error(`[SPRIVO_SMS][${logId}] missing SOLAPI env config`);
    return res.status(500).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "SERVER_CONFIG_ERROR",
        shouldSendReply: false,
      })
    );
  }

  const to = targetNumber;

  const { createHmac } = await import("crypto");
  const date = new Date().toISOString();
  const salt = Math.random().toString(36).slice(2, 14);
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  console.log(`[SPRIVO_SMS][${logId}] solapi request`, {
    toMasked: maskPhone(to),
    fromMasked: maskPhone(from),
    mode,
    messageLen: message.length,
  });

  try {
    const resp = await fetch("https://api.solapi.com/messages/v4/send-many", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        messages: [{ to, from, text: message }],
      }),
    });

    const data = await resp.json().catch(() => null);

    const groupId = data?.groupId ?? data?.group_id ?? null;
    const providerStatus = data?.status ?? data?.data?.status ?? null;
    const dateCompleted =
      data?.dateCompleted ?? data?.data?.dateCompleted ?? null;
    const count = data?.count ?? data?.data?.count ?? {};
    const registeredSuccess = Number(
      count?.registeredSuccess ?? count?.registered ?? 0
    );
    const sentSuccess = Number(count?.sentSuccess ?? count?.sent ?? 0);

    console.log(`[SPRIVO_SMS][${logId}] solapi response`, {
      groupId,
      providerStatus,
      dateCompleted,
      registeredSuccess,
      sentSuccess,
      error: data?.error ?? data?.errors ?? null,
      code: data?.code ?? null,
      message: data?.message ?? null,
    });

    if (!resp.ok) {
      return res.status(200).json(
        createResponse({
          success: false,
          status: "fail",
          reason: `SOLAPI_HTTP_${resp.status}`,
          groupId,
          providerStatus,
        })
      );
    }

    if (data?.error || data?.errors || (data?.code && data?.code >= 400)) {
      return res.status(200).json(
        createResponse({
          success: false,
          status: "fail",
          reason: "SOLAPI_ERROR",
          groupId,
          providerStatus,
        })
      );
    }

    if (!registeredSuccess) {
      return res.status(200).json(
        createResponse({
          success: false,
          status: "fail",
          reason: "SOLAPI_REGISTERED_ZERO",
          groupId,
          providerStatus,
        })
      );
    }

    const pendingStatuses = new Set(["SENDING", "PENDING", "WAITING", "QUEUED"]);
    const successStatuses = new Set(["COMPLETE", "COMPLETED", "DONE", "FINISH", "FINISHED"]);
    const providerStatusUpper = String(providerStatus || "").toUpperCase();

    const isPending =
      pendingStatuses.has(providerStatusUpper) ||
      (!successStatuses.has(providerStatusUpper) && sentSuccess === 0);

    if (isPending || (!dateCompleted && sentSuccess === 0)) {
      return res.status(200).json(
        createResponse({
          success: true,
          status: "pending",
          reason: "SOLAPI_ACCEPTED_NOT_COMPLETED",
          groupId,
          providerStatus,
        })
      );
    }

    return res.status(200).json(
      createResponse({
        success: true,
        status: "success",
        reason: "DELIVERY_CONFIRMED",
        groupId,
        providerStatus,
        sentAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.error(`[SPRIVO_SMS][${logId}] solapi call failed`, err);
    return res.status(500).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "SERVER_INTERNAL_ERROR",
        shouldSendReply: false,
      })
    );
  }
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  const logId = `status_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  const createResponse = ({
    success,
    status,
    reason,
    groupId = null,
    providerStatus = null,
    sentSuccess = null,
    sentFailed = null,
    dateCompleted = null,
  }) => ({
    success,
    status,
    reason,
    logId,
    groupId,
    providerStatus,
    sentSuccess,
    sentFailed,
    dateCompleted,
    checkedAt: now,
  });

if (req.method !== "GET") {
    return res.status(405).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "METHOD_NOT_ALLOWED",
      })
    );
  }

  const rawGroupId = (req.query?.groupId ?? req.query?.groupID ?? req.query?.group_id ?? "").trim();
  const rawLogId = (req.query?.logId ?? req.query?.logID ?? req.query?.log_id ?? "").trim();

  if (!rawGroupId && !rawLogId) {
    console.warn(`[SPRIVO_SMS_STATUS][${logId}][${now}] missing groupId/logId`);
    return res.status(400).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "MISSING_GROUP_ID_OR_LOG_ID",
      })
    );
  }

  // 현재 구조상 logId만으로는 Solapi 조회를 할 수 없으므로 groupId가 필요
  const groupId = rawGroupId || rawLogId;
  if (!groupId) {
    console.warn(`[SPRIVO_SMS_STATUS][${logId}][${now}] groupId lookup not possible`, { rawLogId });
    return res.status(404).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "GROUP_ID_LOOKUP_NOT_SUPPORTED",
      })
    );
  }

  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error(`[SPRIVO_SMS_STATUS][${logId}][${now}] missing SOLAPI env config`);
    return res.status(500).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "SERVER_CONFIG_ERROR",
      })
    );
  }

  const { createHmac } = await import("crypto");
  const date = new Date().toISOString();
  const salt = Math.random().toString(36).slice(2, 14);
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  console.log(`[SPRIVO_SMS_STATUS][${logId}][${now}] solapi status request`, { groupId });

try {
    const resp = await fetch(`https://api.solapi.com/messages/v4/groups/${groupId}`, {
      method: "GET",
      headers: {
        Authorization: authorization,
      },
    });

    const data = await resp.json().catch(() => null);

    const providerStatus = data?.status ?? data?.data?.status ?? null;
    const dateCompleted = data?.dateCompleted ?? data?.data?.dateCompleted ?? null;
    
  const dateCreated = data?.dateCreated ?? data?.data?.dateCreated ?? null;
const dateUpdated = data?.dateUpdated ?? data?.data?.dateUpdated ?? null;const count = data?.count ?? data?.data?.count ?? {};
    const sentSuccess = Number(count?.sentSuccess ?? count?.sent ?? 0);
    const sentFailed = Number(count?.sentFailed ?? count?.failed ?? count?.fail ?? 0);

    console.log(`[SPRIVO_SMS_STATUS][${logId}][${now}] solapi status response`, {
      groupId: data?.groupId ?? data?.data?.groupId ?? groupId,
      providerStatus,
      dateCompleted,
      sentSuccess,
      sentFailed,
      error: data?.error ?? data?.errors ?? null,
      code: data?.code ?? null,
      message: data?.message ?? null,
      httpStatus: resp.status,
    });

    if (!resp.ok) {
      return res.status(200).json(
        createResponse({
          success: false,
          status: "fail",
          reason: `SOLAPI_HTTP_${resp.status}`,
          groupId,
          providerStatus,
          sentSuccess,
          sentFailed,
          dateCompleted,
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
          sentSuccess,
          sentFailed,
          dateCompleted,
        })
      );
    }

  const staleBaseTime = dateUpdated || dateCreated || null;
const staleAgeMs =
  staleBaseTime && !Number.isNaN(Date.parse(staleBaseTime))
    ? Date.now() - Date.parse(staleBaseTime)
    : null;

if (sentSuccess === 0 && sentFailed === 0 && dateCompleted == null && staleAgeMs !== null && staleAgeMs >= 10 * 60 * 1000) {
  return res.status(200).json(
    createResponse({
      success: false,
      status: "fail",
      reason: "STALE_PENDING_TIMEOUT",
      groupId,
      providerStatus,
      sentSuccess,
      sentFailed,
      dateCompleted: null,
    })
  );
}

    const pendingStatuses = new Set(["SENDING", "PENDING", "WAITING", "QUEUED"]);
    const successStatuses = new Set(["COMPLETE", "COMPLETED", "DONE", "FINISH", "FINISHED"]);
    const failStatuses = new Set(["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED"]);

    const providerStatusUpper = String(providerStatus || "").toUpperCase();

    const isPending =
      sentSuccess === 0 && sentFailed === 0 && pendingStatuses.has(providerStatusUpper) ||
      (!successStatuses.has(providerStatusUpper) && !failStatuses.has(providerStatusUpper) && sentSuccess === 0 && sentFailed === 0);

    const isSuccess =
      (successStatuses.has(providerStatusUpper) || !!dateCompleted) && sentSuccess > 0 && sentFailed === 0;

    if (isPending || (!dateCompleted && sentSuccess === 0 && sentFailed === 0)) {
      return res.status(200).json(
        createResponse({
          success: true,
          status: "pending",
          reason: "STILL_PROCESSING",
          groupId,
          providerStatus,
          sentSuccess,
          sentFailed,
          dateCompleted: dateCompleted ?? null,
        })
      );
    }

    if (isSuccess) {
      return res.status(200).json(
        createResponse({
          success: true,
          status: "success",
          reason: "DELIVERY_CONFIRMED",
          groupId,
          providerStatus,
          sentSuccess,
          sentFailed,
          dateCompleted: dateCompleted ?? new Date().toISOString(),
        })
      );
    }

    return res.status(200).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "DELIVERY_FAILED_OR_PROVIDER_ERROR",
        groupId,
        providerStatus,
        sentSuccess,
        sentFailed,
        dateCompleted: dateCompleted ?? null,
      })
    );
  } catch (err) {
    console.error(`[SPRIVO_SMS_STATUS][${logId}][${now}] solapi status fetch failed`, err);
    return res.status(500).json(
      createResponse({
        success: false,
        status: "fail",
        reason: "SERVER_INTERNAL_ERROR",
        groupId,
      })
    );
  }
}

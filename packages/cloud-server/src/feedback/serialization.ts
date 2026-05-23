import type {
  ComputerRecord,
  FeedbackReportRecord,
  UserRecord,
} from "../db/types.js";

export const serializeFeedbackReport = (report: FeedbackReportRecord) => ({
  id: report.id,
  userId: report.userId,
  computerId: report.computerId,
  machineIdentityId: report.machineIdentityId,
  accessSessionId: report.accessSessionId,
  status: report.status,
  comment: report.comment,
  threadId: report.threadId,
  cwd: report.cwd,
  archive: {
    available: report.archiveStorageKey !== null,
    storageKey: report.archiveStorageKey,
    sha256: report.archiveSha256,
    bytes: report.archiveBytes,
    fileCount: report.fileCount,
  },
  errorMessage: report.errorMessage,
  clientContext: report.clientContext,
  machineContext: report.machineContext,
  createdAt: report.createdAt.toISOString(),
  completedAt: report.completedAt?.toISOString() ?? null,
});

export const serializeAdminFeedbackReport = (
  report: FeedbackReportRecord,
  users: readonly UserRecord[],
  computers: readonly ComputerRecord[],
) => {
  const user = users.find((entry) => entry.id === report.userId);
  const computer = computers.find((entry) => entry.id === report.computerId);

  return {
    ...serializeFeedbackReport(report),
    username: user?.username ?? null,
    userEmail: user?.email ?? null,
    computerName: computer?.name ?? null,
  };
};

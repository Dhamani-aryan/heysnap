import { Download, RefreshCw } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi } from "@/lib/api";
import type { AdminFeedbackReport, FeedbackReportStatus } from "@/lib/types";

const STATUS_OPTIONS = ["all", "pending", "complete", "comment_only"] as const;

export const FeedbackPage = () => {
  const feedback = useAdminQuery(() => adminApi.listFeedback({ limit: 200 }).then((data) => data.feedback));
  const [filter, setFilter] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (feedback.data ?? []).filter((report) => {
      if (status !== "all" && report.status !== status) {
        return false;
      }

      if (term.length === 0) {
        return true;
      }

      return [
        report.username ?? "",
        report.userEmail ?? "",
        report.computerName ?? "",
        report.threadId ?? "",
        report.comment,
        report.cwd ?? "",
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [feedback.data, filter, status]);

  const downloadArchive = async (report: AdminFeedbackReport) => {
    setDownloadingId(report.id);
    try {
      const { blob, filename } = await adminApi.downloadFeedbackArchive(report.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename ?? `feedback-${report.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Beta feedback snapshots submitted from active workspaces."
        actions={
          <Button variant="outline" size="sm" onClick={feedback.reload} disabled={feedback.loading} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by user, thread, comment, or cwd..."
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-sm"
        />
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All statuses" : statusLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {feedback.data?.length ?? 0}
        </span>
      </div>

      {feedback.error !== null ? (
        <ErrorState message={feedback.error} onRetry={feedback.reload} />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead className="w-36">Datetime</TableHead>
                <TableHead>Thread ID</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead>CWD</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24 text-right">ZIP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedback.loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 8 }).map((__, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton className="h-4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No feedback found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>
                      <div className="font-medium">{report.username ?? "Unknown"}</div>
                      {report.userEmail === null ? (
                        <div className="font-mono text-xs text-muted-foreground">{report.userId}</div>
                      ) : (
                        <Link to={`/users/${report.userId}`} className="text-xs text-muted-foreground hover:underline">
                          {report.userEmail}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      {report.computerName === null ? (
                        <div className="font-mono text-xs text-muted-foreground">{report.computerId}</div>
                      ) : (
                        <Link to={`/computers/${report.computerId}`} className="font-medium hover:underline">
                          {report.computerName}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={report.createdAt} />
                    </TableCell>
                    <TableCell className="max-w-48 font-mono text-xs text-muted-foreground">
                      <span className="line-clamp-2 break-all">{report.threadId ?? "—"}</span>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <span className="line-clamp-3 whitespace-pre-wrap text-sm">{report.comment}</span>
                    </TableCell>
                    <TableCell className="max-w-56 font-mono text-xs text-muted-foreground">
                      <span className="line-clamp-2 break-all">{report.cwd ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <FeedbackStatusBadge status={report.status} />
                        {report.archive.available ? (
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(report.archive.bytes)} · {report.archive.fileCount ?? 0} files
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={!report.archive.available || downloadingId === report.id}
                        onClick={() => void downloadArchive(report)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {downloadingId === report.id ? "..." : "ZIP"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
};

const FeedbackStatusBadge = ({ status }: { readonly status: FeedbackReportStatus }) => {
  switch (status) {
    case "complete":
      return <Badge variant="success">Complete</Badge>;
    case "comment_only":
      return <Badge variant="warning">Comment only</Badge>;
    case "pending":
      return <Badge variant="muted">Pending</Badge>;
  }
};

const statusLabel = (status: (typeof STATUS_OPTIONS)[number]): string => {
  switch (status) {
    case "complete":
      return "Complete";
    case "comment_only":
      return "Comment only";
    case "pending":
      return "Pending";
    default:
      return "All statuses";
  }
};

const formatBytes = (value: number | null): string => {
  if (value === null || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** power;
  return `${amount >= 10 || power === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[power]}`;
};

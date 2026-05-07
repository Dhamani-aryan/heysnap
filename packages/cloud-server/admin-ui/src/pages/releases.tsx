import { Cloud, Laptop, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { adminApi } from "@/lib/api";
import type { AdminRelease, ReleaseTarget } from "@/lib/types";

export const ReleasesPage = () => {
  const releases = useAdminQuery(() =>
    adminApi.getOverview().then((data) => data.releases),
  );
  const [target, setTarget] = React.useState<ReleaseTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminRelease | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const desktop = (releases.data ?? []).filter((release) => release.target === "desktop");
  const machineServer = (releases.data ?? []).filter((release) => release.target === "machine-server");

  const handleDeleteConfirm = async () => {
    if (deleteTarget === null) {
      return;
    }
    setDeleteBusy(true);
    try {
      await adminApi.deleteRelease(deleteTarget.id);
      toast.success("Release deleted");
      releases.reload();
      setDeleteTarget(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Releases"
        description="Release manifests served to desktop installers and machine-server hosts."
        actions={
          <Button variant="outline" size="sm" onClick={releases.reload} disabled={releases.loading} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {releases.error !== null ? (
        <ErrorState message={releases.error} onRetry={releases.reload} />
      ) : (
        <>
          <ReleaseCard
            title="Desktop"
            description="Electron desktop installers checked at /releases/desktop/latest."
            icon={<Laptop className="h-4 w-4" />}
            target="desktop"
            releases={desktop}
            loading={releases.loading}
            onPublish={() => setTarget("desktop")}
            onDelete={(release) => setDeleteTarget(release)}
          />

          <ReleaseCard
            title="Machine server"
            description="Machine-server host artifacts checked at /releases/machine-server/latest."
            icon={<Cloud className="h-4 w-4" />}
            target="machine-server"
            releases={machineServer}
            loading={releases.loading}
            onPublish={() => setTarget("machine-server")}
            onDelete={(release) => setDeleteTarget(release)}
          />
        </>
      )}

      <PublishDialog
        target={target}
        onClose={() => setTarget(null)}
        onPublished={() => {
          setTarget(null);
          releases.reload();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete release manifest?"
        description={
          deleteTarget !== null
            ? `${deleteTarget.target} ${deleteTarget.channel} ${deleteTarget.platform} ${deleteTarget.version} will be removed.`
            : null
        }
        confirmLabel="Delete release"
        destructive
        busy={deleteBusy}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !deleteBusy && setDeleteTarget(null)}
      />
    </>
  );
};

const ReleaseCard = ({
  title,
  description,
  icon,
  target,
  releases,
  loading,
  onPublish,
  onDelete,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly target: ReleaseTarget;
  readonly releases: AdminRelease[];
  readonly loading: boolean;
  readonly onPublish: () => void;
  readonly onDelete: (release: AdminRelease) => void;
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0">
      <div>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      <Button size="sm" onClick={onPublish} className="gap-2">
        <Plus className="h-3.5 w-3.5" /> Publish
      </Button>
    </CardHeader>
    <CardContent className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Artifact</TableHead>
            <TableHead className="w-32">Released</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6}>
                <Skeleton className="h-5" />
              </TableCell>
            </TableRow>
          ) : releases.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No {target} releases yet
              </TableCell>
            </TableRow>
          ) : (
            releases.map((release) => {
              const artifact = release.dockerImage ?? release.downloadUrl ?? "";
              return (
                <TableRow key={release.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs capitalize">
                      {release.channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{release.platform}</TableCell>
                  <TableCell className="font-mono">{release.version}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="max-w-[260px] truncate text-muted-foreground" title={artifact}>
                        {artifact || "—"}
                      </span>
                      {artifact.length > 0 && <CopyButton value={artifact} label="" className="h-6 px-1.5" />}
                    </span>
                  </TableCell>
                  <TableCell>
                    <RelativeTime value={release.releasedAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => onDelete(release)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

interface ReleaseFormState {
  channel: string;
  platform: string;
  version: string;
  downloadUrl: string;
  sha256: string;
  dockerImage: string;
  notes: string;
}

const emptyForm = (target: ReleaseTarget): ReleaseFormState => ({
  channel: "stable",
  platform: target === "desktop" ? "darwin-arm64" : "default",
  version: "",
  downloadUrl: "",
  sha256: "",
  dockerImage: "",
  notes: "",
});

const PublishDialog = ({
  target,
  onClose,
  onPublished,
}: {
  readonly target: ReleaseTarget | null;
  readonly onClose: () => void;
  readonly onPublished: () => void;
}) => {
  const [form, setForm] = React.useState<ReleaseFormState>(() => emptyForm(target ?? "desktop"));
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (target !== null) {
      setForm(emptyForm(target));
      setSubmitting(false);
    }
  }, [target]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (target === null) {
      return;
    }
    setSubmitting(true);
    try {
      if (target === "desktop") {
        await adminApi.upsertDesktopRelease({
          channel: form.channel.trim(),
          platform: form.platform.trim(),
          version: form.version.trim(),
          downloadUrl: form.downloadUrl.trim(),
          notes: form.notes.trim().length > 0 ? form.notes : null,
        });
      } else {
        await adminApi.upsertMachineServerRelease({
          channel: form.channel.trim(),
          version: form.version.trim(),
          downloadUrl: form.downloadUrl.trim(),
          dockerImage: form.dockerImage.trim().length > 0 ? form.dockerImage.trim() : null,
          metadata: { sha256: form.sha256.trim() },
          notes: form.notes.trim().length > 0 ? form.notes : null,
        });
      }
      toast.success("Release published");
      onPublished();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish {target} release</DialogTitle>
          <DialogDescription>
            Releases are upserted by (target, channel, platform). Publishing again replaces the existing manifest.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="release-channel">Channel</Label>
              <Input
                id="release-channel"
                value={form.channel}
                onChange={(event) => setForm({ ...form, channel: event.target.value })}
                placeholder="stable"
                required
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="release-version">Version</Label>
              <Input
                id="release-version"
                value={form.version}
                onChange={(event) => setForm({ ...form, version: event.target.value })}
                placeholder="0.1.0"
                required
                disabled={submitting}
              />
            </div>
          </div>

          {target === "desktop" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="release-platform">Platform</Label>
                <Input
                  id="release-platform"
                  value={form.platform}
                  onChange={(event) => setForm({ ...form, platform: event.target.value })}
                  placeholder="darwin-arm64"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="release-download">Download URL</Label>
                <Input
                  id="release-download"
                  value={form.downloadUrl}
                  onChange={(event) => setForm({ ...form, downloadUrl: event.target.value })}
                  placeholder="https://downloads.heysnap.xyz/HeySnap-0.1.0-arm64.dmg"
                  type="url"
                  required
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {target === "machine-server" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="release-download">Download URL</Label>
                <Input
                  id="release-download"
                  value={form.downloadUrl}
                  onChange={(event) => setForm({ ...form, downloadUrl: event.target.value })}
                  placeholder="https://downloads.heysnap.xyz/machine-server/0.1.0/linux-x64.tar.gz"
                  type="url"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="release-sha256">SHA256</Label>
                <Input
                  id="release-sha256"
                  value={form.sha256}
                  onChange={(event) => setForm({ ...form, sha256: event.target.value })}
                  placeholder="artifact checksum"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="release-image">Docker image</Label>
                <Input
                  id="release-image"
                  value={form.dockerImage}
                  onChange={(event) => setForm({ ...form, dockerImage: event.target.value })}
                  placeholder="optional legacy image"
                  disabled={submitting}
                />
              </div>
            </>
          )}

          <div className="grid gap-2">
            <Label htmlFor="release-notes">Notes</Label>
            <Textarea
              id="release-notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="What changed?"
              rows={3}
              disabled={submitting}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

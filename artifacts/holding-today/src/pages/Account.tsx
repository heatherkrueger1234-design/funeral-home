import { useState } from "react";
import {
  exportMyData,
  useChangePassword,
  useDeleteAccount,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { reloadToHome } from "@/lib/assets";
import { Download, HardDrive, KeyRound, Loader2, LogOut, Trash2 } from "lucide-react";
import { getUploadUsage, uploadUsageQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

const MIN_PASSWORD_LENGTH = 10;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function Account() {
  const { user, signOut, isSigningOut } = useSession();
  // A Google account has no password to prove, so it sets one instead of
  // changing one, and confirms deletion by typing its address.
  const hasPassword = user?.hasPassword ?? true;
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const { mutate: changePassword, isPending: isChanging } = useChangePassword();
  const { mutate: deleteAccount, isPending: isDeleting } = useDeleteAccount();
  const { data: usage } = useQuery({
    queryKey: uploadUsageQueryKey,
    queryFn: getUploadUsage,
    retry: false,
  });

  const handleChangePassword = (event: React.FormEvent) => {
    event.preventDefault();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Please choose a longer password",
        description: `At least ${MIN_PASSWORD_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }

    changePassword(
      {
        data: hasPassword
          ? { currentPassword, newPassword }
          : { newPassword },
      },
      {
        onSuccess: () => {
          toast({
            title: "Password changed",
            description:
              "You've been signed out everywhere. Please sign in again.",
          });
          setCurrentPassword("");
          setNewPassword("");
          reloadToHome();
        },
      },
    );
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const bundle = await exportMyData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "holding-today-export.json";
      link.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Downloaded",
        description: "Everything you've written is in that file.",
      });
    } catch {
      toast({
        title: "Couldn't build your export",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = () => {
    deleteAccount(
      {
        data: hasPassword
          ? { password: deletePassword }
          : { confirmEmail },
      },
      {
        onSuccess: () => {
          reloadToHome();
        },
      },
    );
  };

  return (
    <PageLayout>
      <PageHeader title="Your Account" description={user?.email ?? ""} />

      <div className="space-y-6 max-w-2xl">
        <section className="glass-panel rounded-2xl p-6">
          <h2 className="font-display text-xl mb-1 flex items-center gap-2">
            <Download className="w-5 h-5 text-primary/70" /> Take your writing
            with you
          </h2>
          <p className="text-muted-foreground text-sm mb-5">
            Everything you've written here — every memory, letter, journal entry
            and record — as a file you keep. Yours, always, with no need to ask.
          </p>

          <div className="flex flex-wrap gap-3">
            {/*
              A plain link rather than a fetch: the archive is streamed and can
              run to gigabytes, so it must go straight to disk rather than
              through the browser's memory. The session cookie rides along.
            */}
            <a
              href="/api/auth/export/archive"
              download
              className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-5 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4 mr-2" />
              Everything, photographs included
            </a>

            <Button
              onClick={handleExport}
              disabled={isExporting}
              variant="secondary"
              className="rounded-full"
            >
              {isExporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Just the writing, as JSON
            </Button>
          </div>

          <p className="text-xs text-muted-foreground/60 mt-4 leading-relaxed">
            The first is a zip holding your photographs and files themselves,
            alongside everything you have written. The second is only the text —
            it lists the photographs but does not contain them.
          </p>
        </section>

        {usage && (
          <section className="glass-panel rounded-2xl p-6">
            <h2 className="font-display text-xl mb-1 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-primary/70" /> Photos and files
            </h2>
            <p className="text-muted-foreground text-sm mb-4">
              {usage.usedBytes === 0
                ? `No photos or files yet — there's room for ${formatBytes(usage.limitBytes)}.`
                : `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)} used.`}
            </p>
            <div
              className="h-2 rounded-full bg-background/60 overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(
                (usage.usedBytes / usage.limitBytes) * 100,
              )}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Storage used"
            >
              <div
                className="h-full bg-primary/70 rounded-full transition-[width]"
                style={{
                  width: `${Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)}%`,
                }}
              />
            </div>
          </section>
        )}

        <section className="glass-panel rounded-2xl p-6">
          <h2 className="font-display text-xl mb-1 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary/70" />{" "}
            {hasPassword ? "Change password" : "Add a password"}
          </h2>
          <p className="text-muted-foreground text-sm mb-5">
            {hasPassword
              ? "Changing your password signs out every device, including this one."
              : "You sign in with Google. Adding a password gives you a second way in, so losing your Google account doesn't lock you out of everything you've written here."}
          </p>
          <form onSubmit={handleChangePassword} className="space-y-4">
            {hasPassword && (
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-background border-white/10"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-background border-white/10"
              />
            </div>
            <Button
              type="submit"
              disabled={isChanging}
              className="rounded-full"
            >
              {isChanging && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Change password
            </Button>
          </form>
        </section>

        <section className="glass-panel rounded-2xl p-6">
          <h2 className="font-display text-xl mb-1 flex items-center gap-2">
            <LogOut className="w-5 h-5 text-primary/70" /> Sign out
          </h2>
          <p className="text-muted-foreground text-sm mb-5">
            Ends this session on this device. Your writing stays exactly where
            it is.
          </p>
          <Button
            onClick={signOut}
            disabled={isSigningOut}
            variant="secondary"
            className="rounded-full"
          >
            {isSigningOut && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Sign out
          </Button>
        </section>

        <section className="rounded-2xl p-6 border border-destructive/30 bg-destructive/5">
          <h2 className="font-display text-xl mb-1 flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" /> Delete this account
          </h2>
          <p className="text-muted-foreground text-sm mb-5">
            This permanently removes your account and everything in it. It
            cannot be undone. Please download your data first if there is any
            chance you'll want it — most people do.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="rounded-full">
                Delete my account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-white/10">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display text-2xl">
                  Permanently delete everything?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Every memory, letter, journal entry, photo and record in this
                  account will be erased. There is no way to bring it back.
                  Enter your password to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-2">
                {hasPassword ? (
                  <>
                    <Label htmlFor="deletePassword">Password</Label>
                    <Input
                      id="deletePassword"
                      type="password"
                      autoComplete="current-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      className="bg-background border-white/10"
                    />
                  </>
                ) : (
                  <>
                    <Label htmlFor="confirmEmail">
                      Type {user?.email} to confirm
                    </Label>
                    <Input
                      id="confirmEmail"
                      type="email"
                      autoComplete="off"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      className="bg-background border-white/10"
                    />
                  </>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my account</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={
                    isDeleting ||
                    (hasPassword ? deletePassword === "" : confirmEmail === "")
                  }
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Delete forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </div>
    </PageLayout>
  );
}

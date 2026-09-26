import { Bell, CreditCard, UserRound } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router";
import { AppShell } from "@/components/app/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSessionUser } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";
import { BillingTab } from "./app/settings/BillingTab";
import { NotificationsTab } from "./app/settings/NotificationsTab";
import { ProfileTab } from "./app/settings/ProfileTab";

const TABS = [
  { value: "profile", label: "Profile", icon: UserRound },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "billing", label: "Billing", icon: CreditCard },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** /app/settings (CONTRACT.md "/app/settings Settings"): Radix Tabs Profile (selected on load), Notifications, Billing. */
export default function Settings() {
  useDocumentTitle("Settings");
  const user = useSessionUser();
  const { hash } = useLocation();
  // "/app/settings#billing" (the sidebar's "View plans") opens that tab; plain /app/settings opens Profile.
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => `#${t.value}` === hash)?.value ?? "profile");

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:gap-8">
        <div>
          <p className="text-sm font-medium text-primary">{user.workspace}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
          <p className="mt-2 text-muted-foreground">Manage your profile, notifications and billing.</p>
        </div>
        {/* Every panel stays mounted (hidden when inactive), so switching tabs never loses typed profile changes. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-6">
          <TabsList aria-label="Settings sections" className="h-12 rounded-2xl p-1.5 shadow-xs">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.value} value={t.value} className="h-9 gap-2 rounded-xl px-3 sm:px-4">
                  <Icon aria-hidden="true" className="hidden min-[360px]:block" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <TabsContent value="profile" forceMount className="data-[state=inactive]:hidden">
            <ProfileTab />
          </TabsContent>
          <TabsContent value="notifications" forceMount className="data-[state=inactive]:hidden">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value="billing" forceMount className="data-[state=inactive]:hidden">
            <BillingTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

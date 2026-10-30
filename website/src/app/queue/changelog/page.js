import Changelog from "../../changelog/Changelog";

export const dynamic = 'force-static';

export const metadata = {
  title: "Queue Manager Changelog — AutoFlow Release Notes",
  description:
    "Every AutoFlow Queue Manager release: new features, improvements and fixes for batch generation in Google Flow.",
  alternates: {
    canonical: "https://www.auto-flow.studio/queue/changelog",
  },
};

export default function QueueChangelogPage() {
  return <Changelog product="queue" />;
}

import type { ReactNode } from "react";
import { B, C, Callout, ExternalLink, H2, InternalLink, List, P, Section, Table } from "../_components/prose";
import { docsHref } from "../_data/nav";

/**
 * The bot pages. A bot is hosted as a worker workload: a background process
 * under systemd with no port and no public URL. Everything here mirrors what
 * the new-project flow and the project pages actually do and quotes their
 * copy as it prints. Nothing may advertise an unverified feature: in this
 * version a worker cannot receive HTTP requests, so a Slack app needs Socket
 * Mode and a bot with a web dashboard needs a separate web project.
 */

const related = (pages: [string, string][]) => (
  <P>
    <B>Related:</B>{" "}
    {pages.map(([id, title], i) => (
      <span key={id}>
        {i > 0 ? ", " : ""}
        <InternalLink href={docsHref(id)}>{title}</InternalLink>
      </span>
    ))}
    .
  </P>
);

export const GUIDE_D: Record<string, () => ReactNode> = {
  "bots-discordjs": () => (
    <Section
      id="bots-discordjs"
      intro="Host a Discord bot written with discord.js: import the repository, add DISCORD_TOKEN, deploy, and let systemd keep it running."
    >
      <P>
        A discord.js bot is a Node.js process that connects to Discord over its gateway and then stays running. It
        does not listen on a port, so on Egg it is a <B>worker</B> workload: a background process that Egg keeps
        running instead of publishing a URL for. If you do not have a bot yet, follow the{" "}
        <ExternalLink href="https://discordjs.guide/">official discord.js guide</ExternalLink> until you have a bot
        that runs locally with <C>npm start</C>. A repository that installs with <C>npm install</C> and starts with{" "}
        <C>npm start</C> deploys here.
      </P>
      <H2 id="bots-discordjs-steps" title="Deploy it" />
      <List ordered>
        <li>
          <B>Import the repository.</B> On New project, pick it from your GitHub account or paste its URL. Egg reads
          the files and shows what it found under “We found”.
        </li>
        <li>
          <B>Keep the detected workload.</B> When <C>discord.js</C> is in the dependencies, the workload is already
          set to <C>Bot or background worker</C>, and the summary says so: “This looks like a Discord bot. It is set
          up as a background app that needs no port, and DISCORD_TOKEN is offered as an environment variable.” If
          Egg guessed wrong, the picker below stays editable.
        </li>
        <li>
          <B>Add the token.</B> In the environment section, the row <C>DISCORD_TOKEN</C> appears with “suggested for
          Discord bot (discord.js)” behind it. Paste the bot token from the{" "}
          <ExternalLink href="https://discord.com/developers/applications">Discord developer portal</ExternalLink>.
          The value is saved by the normal environment variable path and never shown again.
        </li>
        <li>
          <B>Press Deploy.</B> There is no port to fill in. When it is live the deployment page says{" "}
          <C>The worker is running.</C> and explains what that means: the process stays active, Egg checks it every
          few minutes, and if it stops you get an alert on the channel you set up.
        </li>
      </List>
      <H2 id="bots-discordjs-running" title="What Egg does with it" />
      <P>
        systemd, the Linux service manager, starts the bot's process and restarts it with <C>Restart=always</C> if it
        exits. There is no health path to answer, so Egg checks that the process stays active instead. The Service
        card on the project page shows the status, the uptime, the memory and a <B>Restarts</B> count, so a bot
        that keeps crashing is visible without opening the logs. Read the runtime output on the{" "}
        <InternalLink href={docsHref("logs")}>Logs page</InternalLink>. Never paste the token into the repository:
        use <InternalLink href={docsHref("env")}>environment variables</InternalLink>.
      </P>
      <Callout tone="note" title="If it also serves web pages">
        Some bots also host a small web dashboard. Today that is two things on Egg: keep the bot as a worker, and put
        the dashboard in a separate web project. A worker cannot receive HTTP requests in this version, which is also
        why a Discord webhook or interaction proxy needs its own setup outside the bot.
      </Callout>
      {related([
        ["bots-discordpy", "Deploy a Discord bot (discord.py)"],
        ["bots-slack", "Deploy a Slack app (Bolt)"],
        ["bots-telegram", "Deploy a Telegram bot"],
        ["bots-alive", "Keep a bot alive"],
        ["env", "Environment variables"],
      ])}
    </Section>
  ),

  "bots-discordpy": () => (
    <Section
      id="bots-discordpy"
      intro="Host a Discord bot written with discord.py: a requirements.txt with the framework, DISCORD_TOKEN in the environment, and the Python runtime preset."
    >
      <P>
        A discord.py bot is a Python process that stays connected to Discord; it does not listen on a port, so it
        deploys as a <B>worker</B> workload. If you do not have a bot yet, the framework's own repository carries{" "}
        <ExternalLink href="https://github.com/Rapptz/discord.py/tree/master/examples">runnable examples</ExternalLink>
        , from a first bot to slash commands; grow one of those into your own repository. A project with a{" "}
        <C>requirements.txt</C> and an entry point such as <C>main.py</C> deploys: the install step reads your{" "}
        <C>requirements.txt</C> on the container.
      </P>
      <H2 id="bots-discordpy-steps" title="Deploy it" />
      <List ordered>
        <li>
          <B>Import the repository.</B> On New project, pick it from your GitHub account or paste its URL.
        </li>
        <li>
          <B>Keep the detected workload.</B> When <C>discord.py</C> is in your <C>requirements.txt</C>, the workload
          is already set to <C>Bot or background worker</C>, and the summary names DISCORD_TOKEN. The picker stays
          editable if the guess is wrong, and the <C>python</C> preset is the right runtime: check that the start
          command points at your entry point, for example{" "}
          <C>python3 main.py</C>.
        </li>
        <li>
          <B>Add the token.</B> The environment section lists <C>DISCORD_TOKEN</C> with “suggested for Discord bot
          (discord.py)” behind it. Paste the bot token from the{" "}
          <ExternalLink href="https://discord.com/developers/applications">Discord developer portal</ExternalLink>.
          The value is saved once and never shown again.
        </li>
        <li>
          <B>Press Deploy.</B> No port, no domain. When it is live the page says <C>The worker is running.</C>
        </li>
      </List>
      <Callout tone="note" title="Python specifics">
        Egg reads your <C>requirements.txt</C> for package names only, and uses it to spot the framework: version
        pins stay in the file and apply when the container installs them. discord.py needs Python 3.8 or newer, and
        prefix commands must be registered in the setup hook, so an older pin can fail at startup with an import
        error. Check the runtime logs first when a Python bot does not start.
      </Callout>
      {related([
        ["bots-discordjs", "Deploy a Discord bot (discord.js)"],
        ["bots-slack", "Deploy a Slack app (Bolt)"],
        ["bots-telegram", "Deploy a Telegram bot"],
        ["bots-alive", "Keep a bot alive"],
        ["logs", "Logs"],
      ])}
    </Section>
  ),

  "bots-slack": () => (
    <Section
      id="bots-slack"
      intro="Host a Slack app built with Bolt for JavaScript in Socket Mode: the workload is a worker, and the token names are listed for you."
    >
      <P>
        A Slack app built with <ExternalLink href="https://github.com/slackapi/bolt-js">Bolt for JavaScript</ExternalLink>{" "}
        can work two ways. With <B>Socket Mode</B> it connects outward to Slack and never needs a public URL, so it
        deploys as a <B>worker</B> workload like any other bot. With an <B>HTTP receiver</B>, Slack sends events to a
        request URL on your app, and that needs a public address: a worker cannot receive HTTP requests in this
        version, so use Socket Mode here.
      </P>
      <H2 id="bots-slack-steps" title="Deploy it" />
      <List ordered>
        <li>
          <B>Import the repository.</B> On New project, pick it from your GitHub account or paste its URL. A Bolt
          app installs with <C>npm install</C> and starts with <C>npm start</C>.
        </li>
        <li>
          <B>Keep the detected workload.</B> When <C>@slack/bolt</C> is in the dependencies, the workload is already
          set to <C>Bot or background worker</C>. The picker stays editable if the guess is wrong.
        </li>
        <li>
          <B>Add the tokens.</B> The environment section lists two suggested names from your{" "}
          <ExternalLink href="https://api.slack.com/apps">Slack app settings</ExternalLink>:{" "}
          <C>SLACK_BOT_TOKEN</C>, the one that starts with <C>xoxb-</C>, and <C>SLACK_SIGNING_SECRET</C>. If your code
          also reads the app-level Socket Mode token, the one that starts with <C>xapp-</C>, add it under the name
          your code expects, for example <C>SLACK_APP_TOKEN</C>.
        </li>
        <li>
          <B>Press Deploy.</B> No port and no request URL in this mode. When it is live the page says{" "}
          <C>The worker is running.</C>
        </li>
      </List>
      <H2 id="bots-slack-socket" title="Why Socket Mode" />
      <P>
        Socket Mode keeps the advantages of a worker workload: systemd restarts the process if it exits, Egg checks
        that it stays active, and nothing about the container has to be reachable from the internet. Turn it on in
        the app settings on api.slack.com, allow the events and interactivity scopes, and paste the app token into
        the environment as one of the two names above. An HTTP receiver would change the story: the app would have
        to answer requests on a URL, which is what a separate web project does here.
      </P>
      {related([
        ["bots-discordjs", "Deploy a Discord bot (discord.js)"],
        ["bots-telegram", "Deploy a Telegram bot"],
        ["bots-alive", "Keep a bot alive"],
        ["notifications", "Notifications"],
        ["env", "Environment variables"],
      ])}
    </Section>
  ),

  "bots-telegram": () => (
    <Section
      id="bots-telegram"
      intro="Host a Telegram bot written with Telegraf or python-telegram-bot: import the repository, add TELEGRAM_BOT_TOKEN, deploy, and let systemd keep the process running."
    >
      <P>
        A Telegram bot is a process that connects to Telegram and waits for updates. It does not listen on a port, so
        on Egg it is a <B>worker</B> workload: a background process that Egg keeps running instead of publishing a URL
        for. Egg reads your files to find the framework. When <C>telegraf</C> is in your <C>package.json</C> dependencies,
        or <C>python-telegram-bot</C> is in your <C>requirements.txt</C>, the workload is already set to{" "}
        <C>Bot or background worker</C>, and the summary names TELEGRAM_BOT_TOKEN. A project that installs and starts
        with <C>npm start</C>, or with <C>python3 main.py</C>, deploys here.
      </P>
      <H2 id="bots-telegram-steps" title="Deploy it" />
      <List ordered>
        <li>
          <B>Import the repository.</B> On New project, pick it from your GitHub account or paste its URL. Egg reads
          the files and shows what it found under “We found”.
        </li>
        <li>
          <B>Keep the detected workload.</B> When <C>telegraf</C> is in your <C>package.json</C> dependencies, or{" "}
          <C>python-telegram-bot</C> is in your <C>requirements.txt</C>, the workload is already set to{" "}
          <C>Bot or background worker</C>. The picker stays editable if the guess is wrong. If you do not have a bot
          yet, follow the <ExternalLink href="https://telegraf.js.org/">Telegraf documentation</ExternalLink> to write
          one, or start from the framework's own{" "}
          <ExternalLink href="https://github.com/python-telegram-bot/python-telegram-bot/tree/master/examples">
            runnable python-telegram-bot examples
          </ExternalLink>
          .
        </li>
        <li>
          <B>Add the token.</B> The environment section lists <C>TELEGRAM_BOT_TOKEN</C> with “suggested for Telegram bot
          (telegraf)” behind it for a Telegraf project, or “suggested for Telegram bot (python-telegram-bot)” for a
          python-telegram-bot project. Paste the bot token from{" "}
          <ExternalLink href="https://t.me/BotFather">BotFather on Telegram</ExternalLink>. The value is saved by the
          normal environment variable path and never shown again.
        </li>
        <li>
          <B>Press Deploy.</B> There is no port to fill in. When it is live the deployment page says{" "}
          <C>The worker is running.</C> and explains what that means: the process stays active, Egg checks it every
          few minutes, and if it stops you get an alert on the channel you set up.
        </li>
      </List>
      <H2 id="bots-telegram-running" title="What Egg does with it" />
      <P>
        systemd, the Linux service manager, starts the bot's process and restarts it with <C>Restart=always</C> if it
        exits. There is no health path to answer, so Egg checks that the process stays active instead. The Service
        card on the project page shows the status, the uptime, the memory and a <B>Restarts</B> count, so a bot that
        keeps crashing is visible without opening the logs. Read the runtime output on the{" "}
        <InternalLink href={docsHref("logs")}>Logs page</InternalLink>. Never paste the token into the repository: use{" "}
        <InternalLink href={docsHref("env")}>environment variables</InternalLink>.
      </P>
      <Callout tone="note" title="Polling and webhooks">
        A worker holds no public URL in this version, so use long polling. It is the default in both Telegraf and
        python-telegram-bot. A Telegram app that uses webhooks needs a separate web project that receives the updates
        and forwards them to the bot, until workers can expose a URL.
      </Callout>
      {related([
        ["bots-discordjs", "Deploy a Discord bot (discord.js)"],
        ["bots-slack", "Deploy a Slack app (Bolt)"],
        ["bots-alive", "Keep a bot alive"],
        ["env", "Environment variables"],
      ])}
    </Section>
  ),

  "bots-alive": () => (
    <Section
      id="bots-alive"
      intro="What keeps a bot running: systemd restarts, the Restarts count, crash loops and their fixes, and nightly work that belongs in scheduled jobs."
    >
      <P>
        Egg gives a bot the same care a web app gets, adjusted for a process that does not answer requests. A bot
        that fails shows no error page to anyone, so here is what to read instead.
      </P>
      <H2 id="bots-alive-lifecycle" title="Starts, restarts and crash loops" />
      <List>
        <li>
          systemd starts the bot's process with <C>Restart=always</C>: if it exits, systemd restarts it within
          seconds. Most crashes pass unnoticed this way, which is the point, and the first place it shows is the{" "}
          <B>Restarts</B> count on the Service card.
        </li>
        <li>
          A stable bot reads <C>Running</C> on the Service card with a low, slow-moving Restarts number. A climbing
          number means the process keeps exiting: open the{" "}
          <InternalLink href={docsHref("logs")}>runtime logs</InternalLink> and look for the error it prints each
          time it starts.
        </li>
        <li>
          When a bot keeps failing to start, systemd pauses it for a while instead of retrying forever, and the
          status reads <C>Crashed</C>. Fix the error, then press <B>Restart</B> on the Service card to start it
          again.
        </li>
        <li>
          A missing token is the most common first failure: the process starts, reads an empty DISCORD_TOKEN, and
          exits at once. Set values under{" "}
          <InternalLink href={docsHref("env")}>Environment variables</InternalLink> and restart; values reach the
          server on the next deploy.
        </li>
      </List>
      <Table
        head={["Signal", "Where you see it", "What it means"]}
        rows={[
          [
            "A climbing Restarts count",
            "Service card",
            "The process exits as soon as it starts. The runtime logs hold the error it prints each time.",
          ],
          [
            "Status reads Crashed and stays there",
            "Service card",
            "systemd has paused the retries. Fix the error, then press Restart to start the unit again.",
          ],
          [
            "A “has stopped” message",
            <span key="a">
              Your <InternalLink href={docsHref("notifications")}>notification channel</InternalLink>
            </span>,
            "The process did not stay up, or keeps restarting. Egg keeps checking and sends a second message when it is back.",
          ],
          [
            "A memory alert",
            "Your notification channel",
            "The bot crossed its memory limit. A leak grows the memory reading on the Service card over hours; a cache without a cap grows it over days.",
          ],
        ]}
        caption="What each signal about a bot means and where to read it"
      />
      <Callout tone="note" title="Why it works this way">
        A web app that fails shows an error page, and the health check catches it. A bot that fails shows nothing to
        anyone, so the honest signals are the process state, the restart count and the alert: a bot is healthy when
        its process stays up, nothing else.
      </Callout>
      <H2 id="bots-alive-timers" title="Nightly work belongs in scheduled jobs" />
      <P>
        Do not keep a bot awake just to run tomorrow's task, and do not build its schedules on a sleep loop: a crash
        resets the clock. Give the schedule to{" "}
        <InternalLink href={docsHref("jobs")}>Scheduled jobs</InternalLink> instead. A job is a systemd timer next to
        your bot that runs a command inside its current release, with its environment variables, on the times you
        set, in UTC. The bot itself stays quiet in between, needs less memory, and cannot miss a schedule it never
        had.
      </P>
      <H2 id="bots-alive-alerts" title="When it stops, hear about it" />
      <P>
        Add a <InternalLink href={docsHref("notifications")}>notification webhook</InternalLink> before the first bad
        night: down alerts say a worker “has stopped”, recovery says it is back up, and{" "}
        <InternalLink href={docsHref("monitoring")}>monitoring</InternalLink> explains the checks behind them, from
        failed checks in a row to resource limits. The Restarts count on the Service card and these alerts together
        are the whole picture of a bot's health.
      </P>
      {related([
        ["bots-discordjs", "Deploy a Discord bot (discord.js)"],
        ["jobs", "Scheduled jobs"],
        ["logs", "Logs"],
        ["monitoring", "Monitoring and uptime"],
      ])}
    </Section>
  ),
};

import Link from "next/link";

export default function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="card soon-card">
      <span className="badge">Coming soon</span>
      <h2 className="section-title" style={{ marginTop: 12 }}>{title}</h2>
      <p className="muted" style={{ margin: "0 0 14px" }}>{body}</p>
      <Link href="/markets"><button type="button" className="ghost">Back to Explore</button></Link>
    </div>
  );
}

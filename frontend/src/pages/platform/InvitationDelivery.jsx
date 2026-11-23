const deliveryLabels = {
  pending:"Queued for email delivery",sending:"Sending email",sent:"Accepted by the SMTP server",
  failed:"Email delivery failed",uncertain:"Delivery could not be confirmed",
  cancelled:"Email delivery cancelled",smtp_disabled:"SMTP is disabled",
  configuration_required:"Invitation email configuration is incomplete",manual:"Manual invitation",
};

export default function InvitationDelivery({invitation,error}) {
  if (error) return <p role="status" className="mt-3 text-sm text-caution">Invitation status is temporarily unavailable.</p>;
  if (!invitation) return null;
  return <div role="status" className="mt-3 space-y-1 text-sm text-muted">
    <p>Invitation {invitation.state==="closed"?"closed":invitation.state==="expired"?"expired":"awaiting activation"}.</p>
    <p>{deliveryLabels[invitation.deliveryStatus] ?? "Checking email delivery"}</p>
    {invitation.expiresAt&&<p>Expires {new Date(invitation.expiresAt).toLocaleString()}</p>}
    {invitation.emailAvailability==="smtp_disabled"&&invitation.deliveryStatus!=="smtp_disabled"&&<p>SMTP is currently disabled.</p>}
    {invitation.emailAvailability==="configuration_required"&&invitation.deliveryStatus!=="configuration_required"&&<p>Invitation email configuration is currently incomplete.</p>}
  </div>;
}

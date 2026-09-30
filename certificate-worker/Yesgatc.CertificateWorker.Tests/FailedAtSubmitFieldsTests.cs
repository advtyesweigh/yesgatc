using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class FailedAtSubmitFieldsTests
{
    [Fact]
    public void Permanent_cert_fail_stays_submitted_with_reason_never_draft()
    {
        var fields = FirestoreService.BuildFailedAtSubmitFields(
            "eMAAP rejected: party pincode is empty",
            new DateTime(2026, 9, 30, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal(VerificationStatuses.Submitted, fields["status"]);
        Assert.NotEqual(VerificationStatuses.Draft, fields["status"]);
        Assert.Equal("submit", fields["pipelineFailedPhase"]);
        Assert.Equal("eMAAP rejected: party pincode is empty", fields["pipelineFailureMessage"]);
        Assert.False(fields.Values.Any(v => v == VerificationStatuses.Draft));
    }
}

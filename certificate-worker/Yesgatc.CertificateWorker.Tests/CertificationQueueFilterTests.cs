using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class CertificationQueueFilterTests
{
    [Fact]
    public void Apply_skips_superseded_and_voided()
    {
        var records = new[]
        {
            Make("a1", "rc1", "SN1", "approved", supersededBy: "new"),
            Make("a2", "rc1", "SN2", "approved", voidedAt: "2026-01-01T00:00:00Z"),
            Make("s1", "rc1", "SN3", "submitted"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("s1", filtered[0].Id);
    }

    [Fact]
    public void Apply_skips_approved_when_same_serial_has_submitted_resubmit()
    {
        var records = new[]
        {
            Make("old", "rc1", "SN100", "approved"),
            Make("new", "rc1", "SN100", "submitted", resubmittedFrom: "old"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("new", filtered[0].Id);
    }

    [Fact]
    public void Apply_keeps_submitted_resubmit_and_drops_superseded_approved()
    {
        var records = new[]
        {
            Make("old", "rc1", "SN200", "approved", supersededBy: "new"),
            Make("new", "rc1", "SN200", "submitted", resubmittedFrom: "old"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("new", filtered[0].Id);
    }

    [Fact]
    public void Apply_orders_oldest_submitted_first()
    {
        var records = new[]
        {
            Make("new", "rc1", "SN3", "submitted", submittedAt: "2026-11-13T10:00:00Z"),
            Make("old", "rc1", "SN1", "submitted", submittedAt: "2026-11-01T08:00:00Z"),
            Make("mid", "rc1", "SN2", "submitted", submittedAt: "2026-11-07T09:00:00Z"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Equal(["old", "mid", "new"], filtered.Select(record => record.Id).ToArray());
    }

    [Fact]
    public void Apply_scopes_to_rc_id()
    {
        var records = new[]
        {
            Make("a", "rc1", "SN1", "submitted"),
            Make("b", "rc2", "SN2", "submitted"),
        };

        var filtered = CertificationQueueFilter.Apply(records, "rc2");

        Assert.Single(filtered);
        Assert.Equal("b", filtered[0].Id);
    }

    private static SiteCalibrationRecord Make(
        string id,
        string rcId,
        string serial,
        string status,
        string? supersededBy = null,
        string? voidedAt = null,
        string? resubmittedFrom = null,
        string? pdfUrl = null,
        string? submittedAt = null) =>
        new()
        {
            Id = id,
            RcId = rcId,
            SerialNumber = serial,
            Status = status,
            SupersededByResubmissionId = supersededBy,
            CertificateVoidedAt = voidedAt,
            ResubmittedFromId = resubmittedFrom,
            CertificatePdfUrl = pdfUrl,
            SubmittedAt = submittedAt,
        };
}

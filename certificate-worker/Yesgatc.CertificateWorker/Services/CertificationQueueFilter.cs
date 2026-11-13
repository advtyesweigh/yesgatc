using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Submitted → eMAAP fill+certify. Oldest <c>submittedAt</c> first (FIFO)
/// so a stream of new jobs cannot starve earlier ones.
/// </summary>
internal static class CertificationQueueFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(
        IEnumerable<SiteCalibrationRecord> records,
        string? rcId = null) =>
        records
            .Where(record => record.IsEligibleForWorkerQueue)
            .Where(record =>
                string.IsNullOrWhiteSpace(rcId)
                || string.Equals(record.RcId, rcId, StringComparison.Ordinal))
            .OrderBy(record => record.SubmittedAt ?? "", StringComparer.Ordinal)
            .ThenBy(record => record.Id, StringComparer.Ordinal)
            .ToList();
}

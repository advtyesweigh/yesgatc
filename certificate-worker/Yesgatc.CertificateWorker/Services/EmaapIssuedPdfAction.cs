using System.Text.RegularExpressions;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Certificates Issued green action.
/// Pending row (no PDF yet): "Generate Certificate" posts generate-third-party.
/// Temp PDF: "Download Certificate". Signed PDF: "Download".
/// </summary>
internal static class EmaapIssuedPdfAction
{
    private static readonly Regex GenerateCertificateRegex = new(
        @"^generate\s+certificate$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex PdfDownloadRegex = new(
        @"^download(\s+certificate)?$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static readonly Regex ActionLabelRegex = new(
        @"^\s*(Download(\s+Certificate)?|Generate\s+Certificate)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string NormalizeLabel(string? label) =>
        Regex.Replace(label ?? string.Empty, @"\s+", " ").Trim();

    public static bool IsGenerateCertificateLabel(string? label) =>
        GenerateCertificateRegex.IsMatch(NormalizeLabel(label));

    public static bool IsPdfDownloadLabel(string? label) =>
        PdfDownloadRegex.IsMatch(NormalizeLabel(label));

    /// <summary>Row can be primed or opened. Generate and Download never appear together.</summary>
    public static bool IsIssuedPdfActionLabel(string? label) =>
        IsGenerateCertificateLabel(label) || IsPdfDownloadLabel(label);
}

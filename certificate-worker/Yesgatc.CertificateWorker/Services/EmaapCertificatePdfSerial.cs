using System.IO;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace Yesgatc.CertificateWorker.Services;

internal static class EmaapCertificatePdfSerial
{
    private static readonly Regex CertificateNumberRegex = new(
        @"IND\s*/\s*GATC\s*/\s*KL\s*/\s*26\s*/\s*04\s*/\s*26\s*/\s*(\d+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    public static string Compact(string? value) =>
        new string((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());

    /// <summary>Certificate number printed in the PDF. Row labels must not override this.</summary>
    public static string? TryReadCertificateNumber(string? pdfText)
    {
        if (string.IsNullOrWhiteSpace(pdfText))
        {
            return null;
        }

        var match = CertificateNumberRegex.Match(pdfText);
        if (!match.Success)
        {
            return null;
        }

        return $"IND/GATC/KL/26/04/26/{match.Groups[1].Value}";
    }

    public static string? FileCertificateNumber(string? pdfPath)
    {
        if (string.IsNullOrWhiteSpace(pdfPath) || !File.Exists(pdfPath))
        {
            return null;
        }

        try
        {
            using var document = PdfDocument.Open(pdfPath);
            foreach (var page in document.GetPages())
            {
                var number = TryReadCertificateNumber(page.Text);
                if (!string.IsNullOrWhiteSpace(number))
                {
                    return number;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    public static bool TextContainsSerial(string? pdfText, string? serial)
    {
        var needle = Compact(serial);
        var haystack = Compact(pdfText);
        return needle.Length >= 3
            && haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// False when the file is missing, unreadable, or the serial is not in the text.
    /// Never fail-open — a PDF we cannot read must not be bound to a job.
    /// </summary>
    public static bool FileContainsSerial(string? pdfPath, string? serial)
    {
        var needle = Compact(serial);
        if (needle.Length < 3 || string.IsNullOrWhiteSpace(pdfPath) || !File.Exists(pdfPath))
        {
            return false;
        }

        try
        {
            using var document = PdfDocument.Open(pdfPath);
            foreach (var page in document.GetPages())
            {
                if (TextContainsSerial(page.Text, serial))
                {
                    return true;
                }
            }

            return false;
        }
        catch
        {
            return false;
        }
    }
}

using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapIssuedPdfActionTests
{
    [Theory]
    [InlineData("Generate Certificate", true)]
    [InlineData("  generate   certificate ", true)]
    [InlineData("Download", false)]
    [InlineData("Download Certificate", false)]
    [InlineData("Upload Signed PDF", false)]
    public void Generate_label(string label, bool expected) =>
        Assert.Equal(expected, EmaapIssuedPdfAction.IsGenerateCertificateLabel(label));

    [Theory]
    [InlineData("Download", true)]
    [InlineData("Download Certificate", true)]
    [InlineData("Generate Certificate", false)]
    [InlineData("Download Temp Certificate", false)]
    public void Pdf_download_label(string label, bool expected) =>
        Assert.Equal(expected, EmaapIssuedPdfAction.IsPdfDownloadLabel(label));

    [Theory]
    [InlineData("Generate Certificate")]
    [InlineData("Download")]
    [InlineData("Download Certificate")]
    public void Issued_action_accepts_current_emaap_labels(string label) =>
        Assert.True(EmaapIssuedPdfAction.IsIssuedPdfActionLabel(label));
}

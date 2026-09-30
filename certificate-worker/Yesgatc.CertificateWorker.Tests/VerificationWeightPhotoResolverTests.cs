using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class VerificationWeightPhotoResolverTests
{
    private static VerificationWeightPhotoResolver.Slot UrlSlot(string url, string name = "n") =>
        VerificationWeightPhotoResolver.Slot.FromUrl(url, name);

    [Fact]
    public void Dedicated_standard_weight_url_wins()
    {
        var resolved = VerificationWeightPhotoResolver.Resolve(
            UrlSlot("https://x/small-weights.jpg", "small"),
            UrlSlot("https://x/f2-test.jpg", "f2"),
            UrlSlot("https://x/f2-corner.jpg", "corner"));

        Assert.Equal("https://x/small-weights.jpg", resolved.Url);
        Assert.Equal("small", resolved.Name);
    }

    [Fact]
    public void F2_test_weight_satisfies_when_dedicated_empty()
    {
        var resolved = VerificationWeightPhotoResolver.Resolve(
            UrlSlot(""),
            UrlSlot("https://x/f2-test.jpg", "f2"),
            UrlSlot("https://x/f2-corner.jpg", "corner"));

        Assert.Equal("https://x/f2-test.jpg", resolved.Url);
        Assert.Equal("f2", resolved.Name);
    }

    [Fact]
    public void F2_corner_and_storage_path_satisfy_weights()
    {
        var resolved = VerificationWeightPhotoResolver.Resolve(
            UrlSlot(""),
            UrlSlot(""),
            new VerificationWeightPhotoResolver.Slot(
                "", "siteCalibrations/a/instrument-rear-image/1.jpg", "corner", "image/jpeg"));

        Assert.True(resolved.HasEvidence);
        Assert.Equal("siteCalibrations/a/instrument-rear-image/1.jpg", resolved.Path);
        Assert.Equal("corner", resolved.Name);
    }

    [Fact]
    public void Serial_plate_alias_or_path_satisfies_plate()
    {
        var empty = UrlSlot("");
        var fromAlias = VerificationWeightPhotoResolver.ResolvePlate(
            empty,
            UrlSlot("https://x/serial-plate.jpg", "plate"));
        Assert.Equal("https://x/serial-plate.jpg", fromAlias.Url);

        var fromPath = VerificationWeightPhotoResolver.ResolvePlate(
            empty,
            VerificationWeightPhotoResolver.Normalize(
                "", "siteCalibrations/a/stamping-image/1.jpg", "plate", "image/jpeg"));
        Assert.True(fromPath.HasEvidence);
        Assert.Equal("siteCalibrations/a/stamping-image/1.jpg", fromPath.Path);
    }

    [Fact]
    public void Url_field_holding_storage_path_normalizes_to_path()
    {
        var slot = VerificationWeightPhotoResolver.Normalize(
            "siteCalibrations/job/stamping-image/1.jpg",
            "",
            "plate",
            "image/jpeg");
        Assert.Equal("", slot.Url);
        Assert.Equal("siteCalibrations/job/stamping-image/1.jpg", slot.Path);
        Assert.True(slot.HasEvidence);
    }

    [Fact]
    public void Prepared_weights_path_falls_back_to_f2_slots()
    {
        Assert.Equal(
            "weights.jpg",
            VerificationWeightPhotoResolver.PickPreparedWeightsPath(
                ["stamp.jpg", "f2.jpg", "corner.jpg", "weights.jpg", "seal.jpg"]));

        Assert.Equal(
            "f2.jpg",
            VerificationWeightPhotoResolver.PickPreparedWeightsPath(
                ["stamp.jpg", "f2.jpg", "corner.jpg", "", "seal.jpg"]));

        Assert.Equal(
            "corner.jpg",
            VerificationWeightPhotoResolver.PickPreparedWeightsPath(
                ["stamp.jpg", "", "corner.jpg", "", "seal.jpg"]));

        Assert.Equal(
            "",
            VerificationWeightPhotoResolver.PickPreparedWeightsPath(
                ["stamp.jpg", "", "", "", "seal.jpg"]));
    }

    [Fact]
    public void Alias_urls_collapse_to_first_non_empty()
    {
        Assert.Equal(
            "https://x/weight.jpg",
            VerificationWeightPhotoResolver.FirstNonEmptyUrl(
                "",
                "  https://x/weight.jpg  ",
                "https://x/other.jpg"));
    }
}

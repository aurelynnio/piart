using System;
using System.IO;
using System.Linq;
using AIPixelStudio.Editor;
using AIPixelStudio.Runtime;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace AIPixelStudio.Editor.Tests
{
    public class PixelStudioImporterTests
    {
        private string _tempPackageCopy;
        private const string TargetFolder = "Assets/ImportedPixelStudio/WorkshopTest";

        private static string ResolveSampleExportDir()
        {
            var env = Environment.GetEnvironmentVariable("AI_PIXEL_STUDIO_SAMPLE_EXPORT");
            if (!string.IsNullOrEmpty(env) && Directory.Exists(env)) return env;
            var candidate = Path.GetFullPath(Path.Combine(Application.dataPath, "../../examples/workshop-export"));
            return candidate;
        }

        private static void CopyDirectory(string src, string dst)
        {
            Directory.CreateDirectory(dst);
            foreach (var file in Directory.GetFiles(src))
            {
                File.Copy(file, Path.Combine(dst, Path.GetFileName(file)), true);
            }
            foreach (var dir in Directory.GetDirectories(src))
            {
                CopyDirectory(dir, Path.Combine(dst, Path.GetFileName(dir)));
            }
        }

        [SetUp]
        public void SetUp()
        {
            if (AssetDatabase.IsValidFolder(TargetFolder))
            {
                AssetDatabase.DeleteAsset(TargetFolder);
                AssetDatabase.Refresh();
            }
            _tempPackageCopy = Path.Combine(Path.GetTempPath(), "aps_unity_test_" + Guid.NewGuid().ToString("N"));
            var sampleExport = ResolveSampleExportDir();
            Assert.IsTrue(Directory.Exists(sampleExport), $"Sample export directory not found at {sampleExport}");
            CopyDirectory(sampleExport, _tempPackageCopy);
        }

        [TearDown]
        public void TearDown()
        {
            if (!string.IsNullOrEmpty(_tempPackageCopy) && Directory.Exists(_tempPackageCopy))
            {
                Directory.Delete(_tempPackageCopy, true);
            }
        }

        [Test]
        public void A09_ImportWorkshopPackage_VerifiesPointSpritesClipsTilemapAndGameplay()
        {
            var report = PixelStudioImporter.ImportPackage(_tempPackageCopy, TargetFolder);
            Assert.IsTrue(report.Success, string.Join(" | ", report.Errors));
            Assert.GreaterOrEqual(report.ImportedSprites, 10);
            Assert.GreaterOrEqual(report.ImportedClips, 4);
            Assert.GreaterOrEqual(report.ImportedScenes, 1);

            // Verify Point filter + Uncompressed + PPU on imported carpenter sprite
            var map = JsonUtility.FromJson<ImportMapRegistry>(File.ReadAllText(Path.GetFullPath(report.ImportMapPath)));
            var carpEntry = map.Find("character_carpenter");
            Assert.IsNotNull(carpEntry, "character_carpenter must exist in import map");

            var texImporter = AssetImporter.GetAtPath(carpEntry.unityAssetPath) as TextureImporter;
            Assert.IsNotNull(texImporter);
            Assert.AreEqual(FilterMode.Point, texImporter.filterMode);
            Assert.AreEqual(TextureImporterCompression.Uncompressed, texImporter.textureCompression);
            Assert.IsFalse(texImporter.mipmapEnabled);
            Assert.AreEqual(32f, texImporter.spritePixelsPerUnit, 0.01f);

            var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(carpEntry.unityAssetPath);
            Assert.IsNotNull(sprite);
            Assert.AreEqual(32, (int)sprite.rect.width);
            Assert.AreEqual(48, (int)sprite.rect.height);

            // Verify AnimationClip timing & loop
            var walkLeftEntry = map.Find("clip_carpenter_walk_left");
            Assert.IsNotNull(walkLeftEntry);
            var walkLeftClip = AssetDatabase.LoadAssetAtPath<AnimationClip>(walkLeftEntry.unityAssetPath);
            Assert.IsNotNull(walkLeftClip);
            Assert.AreEqual(0.75f, walkLeftClip.length, 0.02f);
            Assert.IsTrue(AnimationUtility.GetAnimationClipSettings(walkLeftClip).loopTime);

            // Verify Scene Prefab has Tilemap, TilemapCollider2D, and Trigger markers
            var sceneEntry = map.Find("scene_workshop");
            Assert.IsNotNull(sceneEntry);
            var scenePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(sceneEntry.unityAssetPath);
            Assert.IsNotNull(scenePrefab);
            Assert.GreaterOrEqual(scenePrefab.GetComponentsInChildren<Tilemap>(true).Length, 1);
            Assert.GreaterOrEqual(scenePrefab.GetComponentsInChildren<TilemapCollider2D>(true).Length, 1);
            Assert.IsTrue(scenePrefab.GetComponentsInChildren<BoxCollider2D>(true).Any(b => b.isTrigger));

            // Verify GameplayBundle & VerificationScene
            var scene = EditorSceneManager.OpenScene(report.VerificationScenePath, OpenSceneMode.Single);
            Assert.IsTrue(scene.IsValid());
            var vc = UnityEngine.Object.FindFirstObjectByType<PixelStudioVerificationController>();
            Assert.IsNotNull(vc);
            Assert.IsNotNull(vc.gameplayBundle);
            Assert.IsNotEmpty(vc.ReadNpcStartLine());
            Assert.IsNotNull(vc.gameplayBundle.FindQuestById("quest_deliver_hammer"));
        }

        [Test]
        public void A10_ReimportModifiedFrame_PreservesGuidsAndIsIdempotent()
        {
            // Initial import
            var r1 = PixelStudioImporter.ImportPackage(_tempPackageCopy, TargetFolder);
            Assert.IsTrue(r1.Success, string.Join(" | ", r1.Errors));

            var map1 = JsonUtility.FromJson<ImportMapRegistry>(File.ReadAllText(Path.GetFullPath(r1.ImportMapPath)));
            var frameEntry = map1.Find("frm_carp_walk_left_2");
            var clipEntry = map1.Find("clip_carpenter_walk_left");
            var sceneEntry = map1.Find("scene_workshop");
            Assert.IsNotNull(frameEntry);
            Assert.IsNotNull(clipEntry);
            Assert.IsNotNull(sceneEntry);

            var guidFrameBefore = frameEntry.unityGuid;
            var guidClipBefore = clipEntry.unityGuid;
            var guidSceneBefore = sceneEntry.unityGuid;
            var assetCountBefore = AssetDatabase.FindAssets("", new[] { TargetFolder }).Length;

            // Simulate editing frame 3 (frm_carp_walk_left_2) and re-exporting with updated SHA-256 in manifest
            var manifestPath = Path.Combine(_tempPackageCopy, "manifest.json");
            var manifestText = File.ReadAllText(manifestPath);
            var manifest = JsonUtility.FromJson<ExportManifestDto>(manifestText);
            var mEntry = manifest.entries.Find(e => e.stableId == "frm_carp_walk_left_2");
            Assert.IsNotNull(mEntry);

            var frameSrcPath = Path.Combine(_tempPackageCopy, mEntry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            tex.LoadImage(File.ReadAllBytes(frameSrcPath));
            var oldPixel = tex.GetPixel(16, 24);
            var newColor = oldPixel.r > 0.5f ? new Color(0.1f, 0.9f, 0.2f, 1f) : new Color(0.95f, 0.2f, 0.1f, 1f);
            tex.SetPixel(16, 24, newColor);
            tex.Apply();
            var newPngBytes = tex.EncodeToPNG();
            UnityEngine.Object.DestroyImmediate(tex);
            File.WriteAllBytes(frameSrcPath, newPngBytes);

            var newSha = PixelStudioImporter.ComputeFileSha256(frameSrcPath);
            var idMarkerIdx = manifestText.IndexOf("\"frm_carp_walk_left_2\"", StringComparison.Ordinal);
            Assert.GreaterOrEqual(idMarkerIdx, 0);
            var shaIdx = manifestText.IndexOf(mEntry.sha256, idMarkerIdx, StringComparison.Ordinal);
            Assert.GreaterOrEqual(shaIdx, 0);
            manifestText = manifestText.Substring(0, shaIdx) + newSha + manifestText.Substring(shaIdx + mEntry.sha256.Length);
            File.WriteAllText(manifestPath, manifestText);

            // Re-import modified package
            var r2 = PixelStudioImporter.ImportPackage(_tempPackageCopy, TargetFolder);
            Assert.IsTrue(r2.Success, string.Join(" | ", r2.Errors));
            Assert.GreaterOrEqual(r2.UpdatedCount, 1);

            var map2 = JsonUtility.FromJson<ImportMapRegistry>(File.ReadAllText(Path.GetFullPath(r2.ImportMapPath)));
            Assert.AreEqual(guidFrameBefore, map2.Find("frm_carp_walk_left_2").unityGuid, "Frame GUID must stay identical on re-import");
            Assert.AreEqual(guidClipBefore, map2.Find("clip_carpenter_walk_left").unityGuid, "Clip GUID must stay identical on re-import");
            Assert.AreEqual(guidSceneBefore, map2.Find("scene_workshop").unityGuid, "Scene Prefab GUID must stay identical on re-import");
            Assert.AreEqual(assetCountBefore, AssetDatabase.FindAssets("", new[] { TargetFolder }).Length, "No duplicate Unity assets may be created");

            // Verify clip reference to sprite is intact (no Missing Reference)
            var clipAsset = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipEntry.unityAssetPath);
            var binding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
            var keys = AnimationUtility.GetObjectReferenceCurve(clipAsset, binding);
            Assert.IsNotNull(keys);
            Assert.IsTrue(keys.All(k => k.value != null), "Every keyframe Sprite reference must stay intact");

            // Re-import identical package a SECOND time -> must be 100% idempotent!
            var r3 = PixelStudioImporter.ImportPackage(_tempPackageCopy, TargetFolder);
            Assert.IsTrue(r3.Success, string.Join(" | ", r3.Errors));
            Assert.AreEqual(0, r3.AddedCount, "Idempotent re-import must add 0 assets");
            Assert.AreEqual(0, r3.UpdatedCount, "Idempotent re-import must update 0 assets");
            Assert.AreEqual(assetCountBefore, AssetDatabase.FindAssets("", new[] { TargetFolder }).Length);
        }
    }
}

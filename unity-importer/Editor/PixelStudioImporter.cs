using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using AIPixelStudio.Runtime;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Tilemaps;

namespace AIPixelStudio.Editor
{
    [Serializable]
    public class ManifestEntryDto
    {
        public string stableId;
        public string revisionId;
        public string assetType;
        public string name;
        public string relativePath;
        public string metadataPath;
        public string sha256;
        public long byteSize;
        public List<string> dependencies = new List<string>();
    }

    [Serializable]
    public class ExportManifestDto
    {
        public int manifestSchemaVersion;
        public string minImporterVersion;
        public string pinnedUnityVersion;
        public string exportRunId;
        public string exportedAt;
        public string projectId;
        public string projectName;
        public int pixelsPerUnit;
        public int tileSizePx;
        public List<ManifestEntryDto> entries = new List<ManifestEntryDto>();
    }

    [Serializable]
    public class Vec2Dto { public float x; public float y; }

    [Serializable]
    public class Vec4Dto { public float x; public float y; public float z; public float w; }

    [Serializable]
    public class SizeDto { public int w; public int h; }

    [Serializable]
    public class SpriteMetaDto
    {
        public string stableId;
        public string revisionId;
        public string name;
        public string assetType;
        public int pixelsPerUnit;
        public SizeDto canvasPx;
        public Vec2Dto unityPivot;
        public Vec4Dto unityNineSliceBorder;
    }

    [Serializable]
    public class ClipFrameDto
    {
        public string frameId;
        public int slotIndex;
        public string revisionId;
        public int durationMs;
        public string frameTexturePath;
    }

    [Serializable]
    public class ClipEventDto
    {
        public string eventId;
        public string name;
        public string frameId;
        public int timeMs;
    }

    [Serializable]
    public class ClipDefDto
    {
        public string stableId;
        public string assetId;
        public string assetSlug;
        public string name;
        public string unityClipName;
        public string action;
        public string direction;
        public float fps;
        public string loopMode;
        public int pixelsPerUnit;
        public Vec2Dto unityPivot;
        public int totalDurationMs;
        public List<ClipFrameDto> frames = new List<ClipFrameDto>();
        public List<ClipEventDto> events = new List<ClipEventDto>();
    }

    [Serializable]
    public class UnityCellDto { public int x; public int y; public int z; }

    [Serializable]
    public class SceneCellDto
    {
        public int col;
        public int row;
        public UnityCellDto unityCell;
        public string tileId;
    }

    [Serializable]
    public class SceneLayerDto
    {
        public string layerId;
        public string name;
        public string kind;
        public int order;
        public bool visible;
        public List<SceneCellDto> cells = new List<SceneCellDto>();
    }

    [Serializable]
    public class ScenePlacementDto
    {
        public string placementId;
        public string assetId;
        public string name;
        public UnityCellDto unityCell;
        public bool blocksMovement;
        public string linkedDialogueId;
        public string linkedQuestId;
    }

    [Serializable]
    public class SceneMarkerDto
    {
        public string markerId;
        public string kind;
        public string name;
        public UnityCellDto unityCell;
        public int widthTiles;
        public int heightTiles;
        public string eventName;
        public string linkedDialogueId;
        public string linkedQuestId;
    }

    [Serializable]
    public class SceneDefDto
    {
        public string stableId;
        public string assetId;
        public string name;
        public int cols;
        public int rows;
        public int tileSizePx;
        public int pixelsPerUnit;
        public string tilesetId;
        public List<SceneLayerDto> layers = new List<SceneLayerDto>();
        public List<ScenePlacementDto> placements = new List<ScenePlacementDto>();
        public List<SceneMarkerDto> markers = new List<SceneMarkerDto>();
    }

    [Serializable]
    public class ImportMapEntry
    {
        public string stableId;
        public string unityAssetPath;
        public string unityGuid;
        public string lastSha256;
        public string revisionId;
    }

    [Serializable]
    public class ImportMapRegistry
    {
        public int mapVersion = 1;
        public List<ImportMapEntry> entries = new List<ImportMapEntry>();

        public ImportMapEntry Find(string stableId) => entries.Find(e => e.stableId == stableId);

        public void Upsert(string stableId, string unityAssetPath, string guid, string sha256, string revId)
        {
            var existing = Find(stableId);
            if (existing == null)
            {
                entries.Add(new ImportMapEntry
                {
                    stableId = stableId,
                    unityAssetPath = unityAssetPath,
                    unityGuid = guid,
                    lastSha256 = sha256,
                    revisionId = revId
                });
            }
            else
            {
                existing.unityAssetPath = unityAssetPath;
                existing.unityGuid = guid;
                existing.lastSha256 = sha256;
                existing.revisionId = revId;
            }
        }
    }

    public class ImportReport
    {
        public bool Success;
        public int AddedCount;
        public int UpdatedCount;
        public int UnchangedCount;
        public int ImportedSprites;
        public int ImportedClips;
        public int ImportedScenes;
        public string VerificationScenePath;
        public string ImportMapPath;
        public List<string> Errors = new List<string>();
        public List<string> Warnings = new List<string>();
    }

    public static class PixelStudioImporter
    {
        public const int SupportedManifestSchemaVersion = 1;

        public static string ComputeFileSha256(string filePath)
        {
            using var sha = SHA256.Create();
            using var stream = File.OpenRead(filePath);
            var hash = sha.ComputeHash(stream);
            return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }

        private static void EnsureUnityFolder(string assetFolderPath)
        {
            var normalized = assetFolderPath.Replace("\\", "/").TrimEnd('/');
            var parts = normalized.Split('/');
            var current = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                var next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[i]);
                }
                current = next;
            }
        }

        private static bool IsSafeRelativePath(string rel)
        {
            if (string.IsNullOrEmpty(rel)) return false;
            var norm = rel.Replace("\\", "/");
            return !norm.StartsWith("/") && !norm.Contains("..") && !norm.Contains(":");
        }

        public static ImportReport ImportPackage(string sourcePackageDir, string targetAssetsFolder)
        {
            var report = new ImportReport();
            if (string.IsNullOrEmpty(targetAssetsFolder) || !targetAssetsFolder.Replace("\\", "/").StartsWith("Assets/"))
            {
                report.Errors.Add("Thư mục đích phải nằm bên trong Assets/ của project Unity.");
                return report;
            }

            var normTarget = targetAssetsFolder.Replace("\\", "/").TrimEnd('/');
            var manifestPath = Path.Combine(sourcePackageDir, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                report.Errors.Add($"Không tìm thấy manifest.json tại {sourcePackageDir}.");
                return report;
            }

            ExportManifestDto manifest;
            try
            {
                manifest = JsonUtility.FromJson<ExportManifestDto>(File.ReadAllText(manifestPath));
            }
            catch (Exception ex)
            {
                report.Errors.Add($"Lỗi phân tích manifest.json: {ex.Message}");
                return report;
            }

            if (manifest == null || manifest.manifestSchemaVersion != SupportedManifestSchemaVersion)
            {
                report.Errors.Add($"Phiên bản manifest không được hỗ trợ (nhận {manifest?.manifestSchemaVersion}, hỗ trợ {SupportedManifestSchemaVersion}).");
                return report;
            }

            // Pre-import checksum & path verification
            foreach (var entry in manifest.entries)
            {
                if (!IsSafeRelativePath(entry.relativePath))
                {
                    report.Errors.Add($"Đường dẫn không an toàn trong manifest: {entry.relativePath}");
                    return report;
                }
                var srcFile = Path.Combine(sourcePackageDir, entry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                if (!File.Exists(srcFile))
                {
                    report.Errors.Add($"Thiếu tệp nguồn: {entry.relativePath}");
                    return report;
                }
                var actualHash = ComputeFileSha256(srcFile);
                if (!string.Equals(actualHash, entry.sha256, StringComparison.OrdinalIgnoreCase))
                {
                    report.Errors.Add($"Sai checksum SHA-256 cho {entry.relativePath}.");
                    return report;
                }
            }

            EnsureUnityFolder(normTarget);
            EnsureUnityFolder(normTarget + "/Textures");
            EnsureUnityFolder(normTarget + "/Textures/Frames");
            EnsureUnityFolder(normTarget + "/Animations");
            EnsureUnityFolder(normTarget + "/Prefabs");
            EnsureUnityFolder(normTarget + "/Scenes");
            EnsureUnityFolder(normTarget + "/Gameplay");

            var mapAssetPath = normTarget + "/AIPixelStudioImportMap.json";
            var mapFullPath = Path.GetFullPath(mapAssetPath);
            var registry = File.Exists(mapFullPath)
                ? JsonUtility.FromJson<ImportMapRegistry>(File.ReadAllText(mapFullPath)) ?? new ImportMapRegistry()
                : new ImportMapRegistry();

            var stableIdToSpritePath = new Dictionary<string, string>();
            var spriteMetaById = new Dictionary<string, SpriteMetaDto>();
            var clipAssetPaths = new List<string>();
            GameplayBundleAsset gameplayAsset = null;
            GameObject lastScenePrefab = null;

            // 1) Import Textures & Clip Frames in-place (preserving Unity GUID on re-import!)
            foreach (var entry in manifest.entries)
            {
                if (!entry.relativePath.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) continue;
                if (entry.assetType == "atlas") continue;

                var existingMap = registry.Find(entry.stableId);
                var subFolder = entry.assetType == "clip_frame" ? "/Textures/Frames/" : "/Textures/";
                var destAssetPath = existingMap != null && !string.IsNullOrEmpty(existingMap.unityAssetPath)
                    ? existingMap.unityAssetPath
                    : normTarget + subFolder + Path.GetFileName(entry.relativePath);

                var srcFull = Path.Combine(sourcePackageDir, entry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                var destFull = Path.GetFullPath(destAssetPath);
                Directory.CreateDirectory(Path.GetDirectoryName(destFull)!);

                bool existed = File.Exists(destFull);
                bool changed = !existed || existingMap == null || existingMap.lastSha256 != entry.sha256;

                if (changed)
                {
                    File.Copy(srcFull, destFull, true);
                    if (existed) report.UpdatedCount++;
                    else report.AddedCount++;
                }
                else
                {
                    report.UnchangedCount++;
                }

                if (!string.IsNullOrEmpty(entry.metadataPath))
                {
                    var metaFull = Path.Combine(sourcePackageDir, entry.metadataPath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                    if (File.Exists(metaFull))
                    {
                        var metaDto = JsonUtility.FromJson<SpriteMetaDto>(File.ReadAllText(metaFull));
                        if (metaDto != null) spriteMetaById[entry.stableId] = metaDto;
                    }
                }

                stableIdToSpritePath[entry.stableId] = destAssetPath;
            }

            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            // Configure TextureImporter settings (Point, Uncompressed, no mipmaps, exact Pivot & 9-slice)
            foreach (var kv in stableIdToSpritePath)
            {
                var stableId = kv.Key;
                var assetPath = kv.Value;
                var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
                if (importer == null) continue;

                bool dirty = false;
                if (importer.textureType != TextureImporterType.Sprite) { importer.textureType = TextureImporterType.Sprite; dirty = true; }
                if (importer.spriteImportMode != SpriteImportMode.Single) { importer.spriteImportMode = SpriteImportMode.Single; dirty = true; }
                if (importer.filterMode != FilterMode.Point) { importer.filterMode = FilterMode.Point; dirty = true; }
                if (importer.textureCompression != TextureImporterCompression.Uncompressed) { importer.textureCompression = TextureImporterCompression.Uncompressed; dirty = true; }
                if (importer.mipmapEnabled) { importer.mipmapEnabled = false; dirty = true; }
                if (!importer.alphaIsTransparency) { importer.alphaIsTransparency = true; dirty = true; }
                if (Math.Abs(importer.spritePixelsPerUnit - manifest.pixelsPerUnit) > 0.001f)
                {
                    importer.spritePixelsPerUnit = manifest.pixelsPerUnit;
                    dirty = true;
                }

                var settings = new TextureImporterSettings();
                importer.ReadTextureSettings(settings);
                if (settings.spriteMeshType != SpriteMeshType.FullRect)
                {
                    settings.spriteMeshType = SpriteMeshType.FullRect;
                    dirty = true;
                }
                if (spriteMetaById.TryGetValue(stableId, out var meta))
                {
                    if (meta.unityPivot != null)
                    {
                        settings.spriteAlignment = (int)SpriteAlignment.Custom;
                        settings.spritePivot = new Vector2(meta.unityPivot.x, meta.unityPivot.y);
                        dirty = true;
                    }
                    if (meta.unityNineSliceBorder != null)
                    {
                        var border = new Vector4(
                            meta.unityNineSliceBorder.x,
                            meta.unityNineSliceBorder.y,
                            meta.unityNineSliceBorder.z,
                            meta.unityNineSliceBorder.w
                        );
                        if (importer.spriteBorder != border)
                        {
                            importer.spriteBorder = border;
                            dirty = true;
                        }
                    }
                }
                if (dirty)
                {
                    importer.SetTextureSettings(settings);
                    importer.SaveAndReimport();
                }

                var manifestEntry = manifest.entries.Find(e => e.stableId == stableId);
                registry.Upsert(
                    stableId,
                    assetPath,
                    AssetDatabase.AssetPathToGUID(assetPath),
                    manifestEntry?.sha256 ?? "",
                    manifestEntry?.revisionId ?? ""
                );
                report.ImportedSprites++;
            }

            // 2) Import AnimationClips & AnimatorController (preserving existing Clip GUID in place!)
            var clipsByAsset = new Dictionary<string, List<(ClipDefDto def, AnimationClip clip)>>();
            foreach (var entry in manifest.entries.Where(e => e.assetType == "clip"))
            {
                var srcFull = Path.Combine(sourcePackageDir, entry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                var clipDef = JsonUtility.FromJson<ClipDefDto>(File.ReadAllText(srcFull));
                if (clipDef == null || clipDef.frames.Count == 0) continue;

                var existingMap = registry.Find(entry.stableId);
                var clipAssetPath = existingMap != null && !string.IsNullOrEmpty(existingMap.unityAssetPath)
                    ? existingMap.unityAssetPath
                    : normTarget + "/Animations/" + clipDef.unityClipName;

                var existingClip = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipAssetPath);
                bool isNew = existingClip == null;
                var clip = isNew ? new AnimationClip() : existingClip;

                clip.frameRate = Math.Max(1f, clipDef.fps > 0 ? clipDef.fps : 8f);
                var keyframes = new List<ObjectReferenceKeyframe>();
                float cumulativeSec = 0f;
                Sprite lastSprite = null;

                foreach (var frame in clipDef.frames)
                {
                    if (!stableIdToSpritePath.TryGetValue(frame.frameId, out var frameAssetPath)) continue;
                    var sp = AssetDatabase.LoadAssetAtPath<Sprite>(frameAssetPath);
                    if (sp == null) continue;
                    keyframes.Add(new ObjectReferenceKeyframe { time = cumulativeSec, value = sp });
                    cumulativeSec += frame.durationMs / 1000f;
                    lastSprite = sp;
                }
                float frameStepSec = 1f / clip.frameRate;
                float lastKeyTime = keyframes.Count > 0 ? keyframes[keyframes.Count - 1].time : 0f;
                float terminalTime = Mathf.Max(lastKeyTime, cumulativeSec - frameStepSec);
                if (lastSprite != null && terminalTime > lastKeyTime + 0.0005f)
                {
                    keyframes.Add(new ObjectReferenceKeyframe { time = terminalTime, value = lastSprite });
                }

                var binding = EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite");
                AnimationUtility.SetObjectReferenceCurve(clip, binding, keyframes.ToArray());

                var clipSettings = AnimationUtility.GetAnimationClipSettings(clip);
                clipSettings.loopTime = clipDef.loopMode == "loop";
                AnimationUtility.SetAnimationClipSettings(clip, clipSettings);

                if (clipDef.events != null && clipDef.events.Count > 0)
                {
                    var animEvents = clipDef.events
                        .Select(ev => new AnimationEvent { functionName = ev.name, time = ev.timeMs / 1000f })
                        .ToArray();
                    AnimationUtility.SetAnimationEvents(clip, animEvents);
                }

                if (isNew)
                {
                    AssetDatabase.CreateAsset(clip, clipAssetPath);
                    report.AddedCount++;
                }
                else
                {
                    EditorUtility.SetDirty(clip);
                    if (existingMap == null || existingMap.lastSha256 != entry.sha256) report.UpdatedCount++;
                    else report.UnchangedCount++;
                }

                registry.Upsert(entry.stableId, clipAssetPath, AssetDatabase.AssetPathToGUID(clipAssetPath), entry.sha256, entry.revisionId);
                clipAssetPaths.Add(clipAssetPath);
                report.ImportedClips++;

                if (!clipsByAsset.ContainsKey(clipDef.assetId))
                    clipsByAsset[clipDef.assetId] = new List<(ClipDefDto, AnimationClip)>();
                clipsByAsset[clipDef.assetId].Add((clipDef, clip));
            }

            // Build/Update AnimatorController per animated asset
            var controllersByAsset = new Dictionary<string, AnimatorController>();
            foreach (var kv in clipsByAsset)
            {
                var ctrlStableId = "animator_" + kv.Key;
                var existingMap = registry.Find(ctrlStableId);
                var ctrlPath = existingMap != null && !string.IsNullOrEmpty(existingMap.unityAssetPath)
                    ? existingMap.unityAssetPath
                    : normTarget + "/Animations/" + kv.Key + "_Controller.controller";

                var ctrl = AssetDatabase.LoadAssetAtPath<AnimatorController>(ctrlPath);
                if (ctrl == null)
                {
                    ctrl = AnimatorController.CreateAnimatorControllerAtPath(ctrlPath);
                    ctrl.AddParameter("DirX", AnimatorControllerParameterType.Float);
                    ctrl.AddParameter("DirY", AnimatorControllerParameterType.Float);
                    ctrl.AddParameter("Action", AnimatorControllerParameterType.Int);
                }
                var sm = ctrl.layers[0].stateMachine;
                foreach (var (def, clip) in kv.Value)
                {
                    var stateName = $"{def.action}_{def.direction}";
                    var existingState = sm.states.FirstOrDefault(s => s.state.name == stateName).state;
                    if (existingState == null)
                    {
                        var st = sm.AddState(stateName);
                        st.motion = clip;
                    }
                    else
                    {
                        existingState.motion = clip;
                    }
                }
                EditorUtility.SetDirty(ctrl);
                registry.Upsert(ctrlStableId, ctrlPath, AssetDatabase.AssetPathToGUID(ctrlPath), "", "");
                controllersByAsset[kv.Key] = ctrl;
            }

            // 3) Import Gameplay Bundle ScriptableObject (Dialogues, Quests, StateFlags)
            var gameplayEntry = manifest.entries.Find(e => e.assetType == "gameplay");
            if (gameplayEntry != null)
            {
                var srcFull = Path.Combine(sourcePackageDir, gameplayEntry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                var rawJson = File.ReadAllText(srcFull);
                var payload = JsonUtility.FromJson<GameplayBundlePayload>(rawJson);
                var existingMap = registry.Find(gameplayEntry.stableId);
                var gpPath = existingMap != null && !string.IsNullOrEmpty(existingMap.unityAssetPath)
                    ? existingMap.unityAssetPath
                    : normTarget + "/Gameplay/GameplayBundle.asset";

                gameplayAsset = AssetDatabase.LoadAssetAtPath<GameplayBundleAsset>(gpPath);
                bool isNew = gameplayAsset == null;
                if (isNew) gameplayAsset = ScriptableObject.CreateInstance<GameplayBundleAsset>();
                gameplayAsset.stableId = gameplayEntry.stableId;
                gameplayAsset.rawJson = rawJson;
                gameplayAsset.stateFlags = payload?.stateFlags ?? new List<StateFlagEntry>();
                gameplayAsset.dialogues = payload?.dialogues ?? new List<DialogueGraphEntry>();
                gameplayAsset.quests = payload?.quests ?? new List<QuestDefinitionEntry>();

                if (isNew) AssetDatabase.CreateAsset(gameplayAsset, gpPath);
                else EditorUtility.SetDirty(gameplayAsset);

                registry.Upsert(gameplayEntry.stableId, gpPath, AssetDatabase.AssetPathToGUID(gpPath), gameplayEntry.sha256, gameplayEntry.revisionId);
            }

            // 4) Import Scenes as Tilemap + Placements + Colliders + Markers Prefab
            foreach (var entry in manifest.entries.Where(e => e.assetType == "scene"))
            {
                var srcFull = Path.Combine(sourcePackageDir, entry.relativePath.Replace("/", Path.DirectorySeparatorChar.ToString()));
                var scDef = JsonUtility.FromJson<SceneDefDto>(File.ReadAllText(srcFull));
                if (scDef == null) continue;

                var rootGo = new GameObject(scDef.name);
                var grid = rootGo.AddComponent<Grid>();
                grid.cellSize = new Vector3(1f, 1f, 0f);

                foreach (var layer in scDef.layers)
                {
                    var layerGo = new GameObject(layer.name);
                    layerGo.transform.SetParent(rootGo.transform, false);
                    var tm = layerGo.AddComponent<Tilemap>();
                    var tmr = layerGo.AddComponent<TilemapRenderer>();
                    tmr.sortingOrder = layer.order;
                    if (layer.kind == "ground" || layer.kind == "collision")
                    {
                        layerGo.AddComponent<TilemapCollider2D>();
                    }
                    foreach (var cell in layer.cells)
                    {
                        var tile = ScriptableObject.CreateInstance<Tile>();
                        tile.name = cell.tileId;
                        tm.SetTile(new Vector3Int(cell.unityCell.x, cell.unityCell.y, 0), tile);
                    }
                }

                // Place objects & NPCs
                var objectsRoot = new GameObject("Placements");
                objectsRoot.transform.SetParent(rootGo.transform, false);
                foreach (var p in scDef.placements)
                {
                    var go = new GameObject(p.name);
                    go.transform.SetParent(objectsRoot.transform, false);
                    go.transform.localPosition = new Vector3(p.unityCell.x + 0.5f, p.unityCell.y + 0.5f, 0f);
                    var sr = go.AddComponent<SpriteRenderer>();
                    sr.sortingOrder = 10;
                    if (stableIdToSpritePath.TryGetValue(p.assetId, out var spPath))
                    {
                        sr.sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spPath);
                    }
                    if (controllersByAsset.TryGetValue(p.assetId, out var ctrl))
                    {
                        var anim = go.AddComponent<Animator>();
                        anim.runtimeAnimatorController = ctrl;
                    }
                    if (p.blocksMovement)
                    {
                        go.AddComponent<BoxCollider2D>();
                    }
                    var mk = go.AddComponent<PixelStudioMarker>();
                    mk.stableId = p.placementId;
                    mk.markerKind = "placement";
                    mk.linkedDialogueId = p.linkedDialogueId;
                    mk.linkedQuestId = p.linkedQuestId;
                }

                // Place Spawns, Doors & Triggers
                var markersRoot = new GameObject("Markers");
                markersRoot.transform.SetParent(rootGo.transform, false);
                foreach (var m in scDef.markers)
                {
                    var mGo = new GameObject($"{m.kind}_{m.name}");
                    mGo.transform.SetParent(markersRoot.transform, false);
                    mGo.transform.localPosition = new Vector3(m.unityCell.x + 0.5f, m.unityCell.y + 0.5f, 0f);
                    var box = mGo.AddComponent<BoxCollider2D>();
                    box.isTrigger = true;
                    box.size = new Vector2(Math.Max(1, m.widthTiles), Math.Max(1, m.heightTiles));
                    var mk = mGo.AddComponent<PixelStudioMarker>();
                    mk.stableId = m.markerId;
                    mk.markerKind = m.kind;
                    mk.eventName = m.eventName;
                    mk.linkedDialogueId = m.linkedDialogueId;
                    mk.linkedQuestId = m.linkedQuestId;
                }

                var existingMap = registry.Find(entry.stableId);
                var prefabPath = existingMap != null && !string.IsNullOrEmpty(existingMap.unityAssetPath)
                    ? existingMap.unityAssetPath
                    : normTarget + "/Prefabs/" + scDef.stableId + ".prefab";

                lastScenePrefab = PrefabUtility.SaveAsPrefabAsset(rootGo, prefabPath);
                UnityEngine.Object.DestroyImmediate(rootGo);
                registry.Upsert(entry.stableId, prefabPath, AssetDatabase.AssetPathToGUID(prefabPath), entry.sha256, entry.revisionId);
                report.ImportedScenes++;
            }

            // 5) Create/Update Verification Scene
            var scenePath = normTarget + "/Scenes/VerificationScene.unity";
            var verifyScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camGo = new GameObject("Main Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.orthographic = true;
            cam.orthographicSize = 5f;
            camGo.transform.position = new Vector3(5f, 4f, -10f);

            Animator foundNpcAnim = null;
            if (lastScenePrefab != null)
            {
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(lastScenePrefab, verifyScene);
                foundNpcAnim = inst.GetComponentInChildren<Animator>();
            }
            var ctrlGo = new GameObject("VerificationController");
            var vc = ctrlGo.AddComponent<PixelStudioVerificationController>();
            vc.npcAnimator = foundNpcAnim;
            vc.gameplayBundle = gameplayAsset;

            EditorSceneManager.SaveScene(verifyScene, scenePath);
            report.VerificationScenePath = scenePath;

            // Save persistent stableId -> GUID registry
            File.WriteAllText(mapFullPath, JsonUtility.ToJson(registry, true));
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            report.ImportMapPath = mapAssetPath;
            report.Success = true;
            return report;
        }
    }
}

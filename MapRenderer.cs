using SDL2;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Media.Media3D;

namespace WpfApp2.Game
{
    public abstract class MapRenderer
    {
        public int MapWidth => MapToRender.Width;
        public int MapHeight => MapToRender.Height;

        public int RenderedMapWidth { get; protected set; }

        public int RenderedMapHeight { get; protected set; }

        public Map MapToRender { get; set; }

        public float HorizontalSpacing { get; set; }
        public float VerticalSpacing { get; set; }

        public int TileWidth { get; private set; }
        public int TileHeight { get; private set; }

        public Camera CurrentCamera { get; set; }

        public IntPtr Renderer { get; protected set; }

        public MapRenderer(Map map, int tileWidth, int tileHeight, IntPtr renderer)
        {
            MapToRender = map;
            TileWidth = tileWidth;
            TileHeight = tileHeight;
            Renderer = renderer;
        }

        public virtual void Render()
        {
            if (MapToRender == null)
            {
                return;
            }

            Dictionary<IntPtr, List<TileRenderData>> textureBatches = new Dictionary<IntPtr, List<TileRenderData>>();

            // Calculate visible bounds (as above)
            int startX = Math.Max(0, (int)(-CurrentCamera.CameraX / (TileWidth * CurrentCamera.ZoomScale)) - 1);
            int startY = Math.Max(0, (int)(-CurrentCamera.CameraY / (TileHeight * CurrentCamera.ZoomScale)) - 1);
            int endX = Math.Min(MapToRender.Width, startX + (int)(CurrentCamera.ScreenWidth / (TileWidth * CurrentCamera.ZoomScale)) + 4);
            int endY = Math.Min(MapToRender.Height, startY + (int)(CurrentCamera.ScreenHeight / (TileHeight * CurrentCamera.ZoomScale)) + 4);

            // Group tiles by texture
            for (int y = startY; y < endY; y++)
            {
                for (int x = startX; x < endX; x++)
                {
                    var tile = MapToRender.Tiles[x, y];
                    if (tile?.Texture == IntPtr.Zero) continue;

                    if (!textureBatches.ContainsKey(tile.Texture))
                        textureBatches[tile.Texture] = new List<TileRenderData>();

                    textureBatches[tile.Texture].Add(new TileRenderData { X = x, Y = y });
                }
            }

            // Render batched by texture
            foreach (var batch in textureBatches)
            {
                foreach (var tileData in batch.Value)
                {
                    RenderTile(tileData.X, tileData.Y, batch.Key, TileWidth, TileHeight);
                }
            }
        }

        private struct TileRenderData
        {
            public int X;
            public int Y;
        }
        

        public abstract Tile GetMapPositionAtMousePosition(int mouseX, int mouseY);

        public abstract void RenderTile(int x, int y, IntPtr texture, int texWidth, int texHeight);
    }

    public class HexMapRenderer : MapRenderer
    {
        public HexMapRenderer(Map map, int tileWidth, int tileHeight, float horizontalSpacing, float verticalSpacing, IntPtr renderer) :
                base(map, tileWidth, tileHeight, renderer)
        {
            HorizontalSpacing = horizontalSpacing;
            VerticalSpacing = verticalSpacing;

            RenderedMapWidth = map.Width * (int)(tileWidth + horizontalSpacing);
            RenderedMapHeight = map.Height * (int)(tileHeight * verticalSpacing);
        }

        public override void Render()
        {
            if (MapToRender == null)
            {
                return;
            }

            for (int y = 0; y < MapToRender.Height; y++)
            {
                for (int x = 0; x < MapToRender.Width; x++)
                {
                    Tile tile = MapToRender.Tiles[x, y];

                    if (tile != null)
                    {
                        RenderTile(x, y, tile.Texture, TileWidth, TileHeight);
                    }
                }
            }
        }

        public Tile GetTileAt(int x, int y )
        {
            return MapToRender.Tiles[x, y];
        }

        public override Tile GetMapPositionAtMousePosition(int mouseX, int mouseY)
        {
            // Calculate the scaled dimensions of the map
            int scaledMapWidth = (int)(RenderedMapWidth * CurrentCamera.ZoomScale);
            int scaledMapHeight = (int)(RenderedMapHeight * CurrentCamera.ZoomScale);

            // Calculate the position to center the map on the screen
            int mapX = (CurrentCamera.ScreenWidth - scaledMapWidth) / 2 - (int)(CurrentCamera.CameraX * CurrentCamera.ZoomScale);
            int mapY = (CurrentCamera.ScreenHeight - scaledMapHeight) / 2 - (int)(CurrentCamera.CameraY * CurrentCamera.ZoomScale);

            // Convert the mouse coordinates to map coordinates
            int mapMouseX = (int)((mouseX - mapX) / CurrentCamera.ZoomScale);
            int mapMouseY = (int)((mouseY - mapY) / CurrentCamera.ZoomScale);

            mapMouseY -= (int)(TileWidth * VerticalSpacing);

            int gridHeight = (int)(TileWidth * 0.75f);

            // Calculate the clicked tile coordinates
            int tileY = (int)(mapMouseY / (gridHeight));

            // if the row is odd, we need to offset the x position by half a hex
            int offsetX = (tileY % 2 == 0) ? TileWidth / 2 : 0;
            int tileX = (int)((mapMouseX - offsetX) / (TileWidth));

            // Check if the clicked tile is within the map bounds
            if (tileX >= 0 && tileX < MapToRender.Width &&
                tileY >= 0 && tileY < MapToRender.Height)
            {
                return MapToRender.Tiles[tileX, tileY];
            }

            return null;
        }

        public override void RenderTile(int x, int y, IntPtr texture, int texWidth, int texHeight)
        {
            // Calculate the scaled dimensions of the map
            int scaledMapWidth = (int)(RenderedMapWidth * CurrentCamera.ZoomScale);
            int scaledMapHeight = (int)(RenderedMapHeight * CurrentCamera.ZoomScale);

            // Calculate the position to center the map on the screen
            int mapX = (CurrentCamera.ScreenWidth - scaledMapWidth) / 2 - (int)(CurrentCamera.CameraX * CurrentCamera.ZoomScale);
            int mapY = (CurrentCamera.ScreenHeight - scaledMapHeight) / 2 - (int)(CurrentCamera.CameraY * CurrentCamera.ZoomScale);

            // Calculate the position of the tile on the screen
            int offsetX = (y % 2 == 0) ? TileWidth / 2 : 0;
            //int screenX = mapX + (int)((x * (TileWidth + HorizontalSpacing) + offsetX) * CurrentCamera.ZoomScale);
            //int screenY = mapY + (int)((y * TileHeight * VerticalSpacing) * CurrentCamera.ZoomScale);
            float screenX = (x * TileWidth * CurrentCamera.ZoomScale) + CurrentCamera.CameraX;
            float screenY = (y * TileHeight * CurrentCamera.ZoomScale) + CurrentCamera.CameraY;


            // Create an SDL_Rect for the tile
            SDL.SDL_Rect destRect = new SDL.SDL_Rect
            {
                x = (int)Math.Round(screenX),  // Round instead of truncate
                y = (int)Math.Round(screenY),
                w = (int)Math.Round(texWidth * CurrentCamera.ZoomScale) + 1,
                h = (int)Math.Round(texHeight * CurrentCamera.ZoomScale) + 1
            };

            // Create an SDL_Rect for the source texture
            SDL.SDL_Rect srcRect = new SDL.SDL_Rect
            {
                x = 0,
                y = 0,
                w = texWidth,
                h = texHeight
            };

            // Render the tile texture
            SDL.SDL_RenderCopy(Renderer, texture, ref srcRect, ref destRect);
        }
    }    
}
